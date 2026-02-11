import { inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import type { Observable, Subscription } from 'rxjs';
import {
  catchError,
  finalize,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
  timer
} from 'rxjs';
import { Router } from '@angular/router';
import { jwtDecode } from 'jwt-decode';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState
} from '@ngrx/signals';
import { computed } from '@angular/core';
import type { User } from '@features/users/models/user.types';
import type {
  AuthResponse,
  CustomJwtPayload,
  LoginCredentials,
  RefreshTokensRequest,
  RegisterRequest,
  TokensResponse
} from '../models/auth.types';
import { StorageService } from '@core/services/storage.service';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';
import { navigateToLogin } from '@features/auth/utils/navigate-to-login';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@features/auth/context-tokens/error-notifications';

const AUTH_STORAGE_KEY = 'auth_storage';
const TOKEN_REFRESH_WINDOW_SECONDS = 60;

const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

type AuthState = {
  authResponse: AuthResponse | null;
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(() => {
    const storage = inject(StorageService);
    return {
      authResponse: storage.getItem<AuthResponse>(AUTH_STORAGE_KEY) ?? null
    };
  }),
  withComputed((store) => ({
    user: computed<User | null>(() => store.authResponse()?.user ?? null),
    isAuthenticated: computed(() => store.authResponse() !== null),
    isAdmin: computed(() => store.authResponse()?.user?.isAdmin ?? false)
  })),
  withMethods((store) => {
    const http = inject(HttpClient);
    const router = inject(Router);
    const storage = inject(StorageService);

    let refreshSubscription: Subscription | undefined;
    let refreshInFlight$: Observable<TokensResponse | null> | null = null;

    function saveAuthResponse(response: AuthResponse): void {
      storage.setItem(AUTH_STORAGE_KEY, response);
      patchState(store, { authResponse: response });
      scheduleTokenRefresh();
    }

    function scheduleTokenRefresh(): void {
      refreshSubscription?.unsubscribe();

      const expiryTime = getTokenExpiryTime();
      if (!expiryTime) return;

      const timeToRefresh =
        expiryTime - Date.now() - TOKEN_REFRESH_WINDOW_SECONDS * 1000;

      const handleRefreshResult = {
        next: (tokens: TokensResponse | null) => {
          if (!tokens) logout(router.url);
        },
        error: () => logout(router.url)
      };

      if (timeToRefresh <= 0) {
        refreshSubscription = refreshTokens().subscribe(handleRefreshResult);
        return;
      }

      refreshSubscription = timer(timeToRefresh)
        .pipe(switchMap(() => refreshTokens()))
        .subscribe(handleRefreshResult);
    }

    function getAccessToken(): string | null {
      return store.authResponse()?.tokens.access_token ?? null;
    }

    function getRefreshToken(): string | null {
      return store.authResponse()?.tokens.refresh_token ?? null;
    }

    function isAccessTokenExpired(): boolean {
      const token = getAccessToken();
      if (!token) return true;

      try {
        const decoded = jwtDecode<CustomJwtPayload>(token);
        return decoded.exp ? decoded.exp < Date.now() / 1000 : false;
      } catch {
        return true;
      }
    }

    function getTokenExpiryTime(): number | null {
      const token = getAccessToken();
      if (!token) return null;

      try {
        const decoded = jwtDecode<CustomJwtPayload>(token);
        return decoded.exp ? decoded.exp * 1000 : null;
      } catch {
        return null;
      }
    }

    function updateCurrentUser(user: User): void {
      const current = store.authResponse();
      if (!current) return;

      const updated: AuthResponse = { ...current, user };
      storage.setItem(AUTH_STORAGE_KEY, updated);
      patchState(store, { authResponse: updated });
    }

    function clearSession(): void {
      refreshSubscription?.unsubscribe();
      refreshInFlight$ = null;
      storage.removeItem(AUTH_STORAGE_KEY);
      patchState(store, { authResponse: null });
    }

    function login(credentials: LoginCredentials): Observable<AuthResponse> {
      return http
        .post<AuthResponse>(AuthApiEnum.Login, credentials, {
          context: silentContext()
        })
        .pipe(tap((response) => saveAuthResponse(response)));
    }

    function register(registerData: RegisterRequest): Observable<User> {
      return http.post<User>(AuthApiEnum.Register, registerData, {
        context: silentContext()
      });
    }

    function logout(returnUrl?: string): void {
      refreshSubscription?.unsubscribe();
      refreshInFlight$ = null;

      const completeLogout = () => {
        if (returnUrl) {
          navigateToLogin(router, returnUrl);
        } else {
          void router.navigate([`/${AppRouteSegmentEnum.Login}`]);
        }
      };

      if (store.isAuthenticated()) {
        http
          .post(AuthApiEnum.Logout, {}, { context: silentContext() })
          .pipe(
            finalize(() => {
              storage.removeItem(AUTH_STORAGE_KEY);
              patchState(store, { authResponse: null });
              completeLogout();
            })
          )
          .subscribe();
      } else {
        completeLogout();
      }
    }

    function getProfile(): Observable<User> {
      return http
        .get<User>(AuthApiEnum.Profile)
        .pipe(tap((profile) => updateCurrentUser(profile)));
    }

    function refreshTokens(): Observable<TokensResponse | null> {
      if (refreshInFlight$) {
        return refreshInFlight$;
      }

      let refreshToken = getRefreshToken();

      // Fallback: if store state has no refresh token, try loading from storage
      if (!refreshToken) {
        const saved = storage.getItem<AuthResponse>(AUTH_STORAGE_KEY);
        if (saved?.tokens?.refresh_token) {
          patchState(store, { authResponse: saved });
          refreshToken = saved.tokens.refresh_token;
        }
      }

      if (!refreshToken) {
        clearSession();
        return of(null);
      }

      const request: RefreshTokensRequest = { refresh_token: refreshToken };

      refreshInFlight$ = http
        .post<AuthResponse>(AuthApiEnum.RefreshToken, request, {
          context: silentContext()
        })
        .pipe(
          tap((response) => saveAuthResponse(response)),
          map((response) => response.tokens),
          catchError((error) => {
            storage.removeItem(AUTH_STORAGE_KEY);
            patchState(store, { authResponse: null });
            return throwError(() => error);
          }),
          finalize(() => {
            refreshInFlight$ = null;
          }),
          shareReplay(1)
        );

      return refreshInFlight$;
    }

    function initFromStorage(): void {
      if (store.authResponse()) {
        // Defer to avoid circular dependency: AuthStore → HttpClient → jwtInterceptor → AuthStore (NG0200).
        // The store must be fully constructed before making HTTP requests.
        // The auth guard handles immediate refresh for expired tokens during route navigation.
        setTimeout(() => scheduleTokenRefresh(), 0);
      }
    }

    function destroyRefresh(): void {
      refreshSubscription?.unsubscribe();
      refreshInFlight$ = null;
    }

    return {
      getAccessToken,
      getRefreshToken,
      isAccessTokenExpired,
      getTokenExpiryTime,
      saveAuthResponse,
      updateCurrentUser,
      clearSession,
      login,
      register,
      logout,
      getProfile,
      refreshTokens,
      _initFromStorage: initFromStorage,
      _destroyRefresh: destroyRefresh
    };
  }),
  withHooks({
    onInit(store) {
      store._initFromStorage();
    },
    onDestroy(store) {
      store._destroyRefresh();
    }
  })
);
