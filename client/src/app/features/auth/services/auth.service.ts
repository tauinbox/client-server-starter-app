import { inject, Injectable } from '@angular/core';
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
import type { User } from '@features/users/models/user.types';
import type {
  AuthResponse,
  LoginCredentials,
  RefreshTokensRequest,
  RegisterRequest,
  TokensResponse
} from '../models/auth.types';
import { StorageService } from '@core/services/storage.service';
import { AuthStore, AUTH_STORAGE_KEY } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import { navigateToLogin } from '../utils/navigate-to-login';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '../context-tokens/error-notifications';

const TOKEN_REFRESH_WINDOW_SECONDS = 60;

const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly #http = inject(HttpClient);
  readonly #router = inject(Router);
  readonly #storage = inject(StorageService);
  readonly #authStore = inject(AuthStore);

  #refreshSubscription: Subscription | undefined;
  #refreshInFlight$: Observable<TokensResponse | null> | null = null;

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.#http
      .post<AuthResponse>(AuthApiEnum.Login, credentials, {
        context: silentContext()
      })
      .pipe(
        tap((response) => {
          this.#authStore.saveAuthResponse(response);
          this.scheduleTokenRefresh();
        })
      );
  }

  register(registerData: RegisterRequest): Observable<User> {
    return this.#http.post<User>(AuthApiEnum.Register, registerData, {
      context: silentContext()
    });
  }

  logout(returnUrl?: string): void {
    this.cancelRefresh();

    const completeLogout = () => {
      if (returnUrl) {
        navigateToLogin(this.#router, returnUrl);
      } else {
        void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`]);
      }
    };

    if (this.#authStore.isAuthenticated()) {
      this.#http
        .post(AuthApiEnum.Logout, {}, { context: silentContext() })
        .pipe(
          finalize(() => {
            this.#authStore.clearSession();
            completeLogout();
          })
        )
        .subscribe();
    } else {
      completeLogout();
    }
  }

  getProfile(): Observable<User> {
    return this.#http
      .get<User>(AuthApiEnum.Profile)
      .pipe(tap((profile) => this.#authStore.updateCurrentUser(profile)));
  }

  refreshTokens(): Observable<TokensResponse | null> {
    if (this.#refreshInFlight$) {
      return this.#refreshInFlight$;
    }

    let refreshToken = this.#authStore.getRefreshToken();

    // Fallback: if store state has no refresh token, try loading from storage
    if (!refreshToken) {
      const saved = this.#storage.getItem<AuthResponse>(AUTH_STORAGE_KEY);
      if (saved?.tokens?.refresh_token) {
        this.#authStore.saveAuthResponse(saved);
        refreshToken = saved.tokens.refresh_token;
      }
    }

    if (!refreshToken) {
      this.#authStore.clearSession();
      return of(null);
    }

    const request: RefreshTokensRequest = { refresh_token: refreshToken };

    this.#refreshInFlight$ = this.#http
      .post<AuthResponse>(AuthApiEnum.RefreshToken, request, {
        context: silentContext()
      })
      .pipe(
        tap((response) => {
          this.#authStore.saveAuthResponse(response);
          this.scheduleTokenRefresh();
        }),
        map((response) => response.tokens),
        catchError((error) => {
          this.#authStore.clearSession();
          return throwError(() => error);
        }),
        finalize(() => {
          this.#refreshInFlight$ = null;
        }),
        shareReplay(1)
      );

    return this.#refreshInFlight$;
  }

  scheduleTokenRefresh(): void {
    this.#refreshSubscription?.unsubscribe();

    const expiryTime = this.#authStore.getTokenExpiryTime();
    if (!expiryTime) return;

    const timeToRefresh =
      expiryTime - Date.now() - TOKEN_REFRESH_WINDOW_SECONDS * 1000;

    const handleRefreshResult = {
      next: (tokens: TokensResponse | null) => {
        if (!tokens) this.logout(this.#router.url);
      },
      error: () => this.logout(this.#router.url)
    };

    if (timeToRefresh <= 0) {
      this.#refreshSubscription =
        this.refreshTokens().subscribe(handleRefreshResult);
      return;
    }

    this.#refreshSubscription = timer(timeToRefresh)
      .pipe(switchMap(() => this.refreshTokens()))
      .subscribe(handleRefreshResult);
  }

  cancelRefresh(): void {
    this.#refreshSubscription?.unsubscribe();
    this.#refreshInFlight$ = null;
  }

  initSession(): void {
    if (this.#authStore.isAuthenticated()) {
      this.scheduleTokenRefresh();
    }
  }
}
