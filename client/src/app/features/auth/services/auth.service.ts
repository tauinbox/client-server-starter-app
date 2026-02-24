import { inject, Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpContext } from '@angular/common/http';
import type { Observable, Subscription } from 'rxjs';
import {
  finalize,
  firstValueFrom,
  from,
  of,
  shareReplay,
  switchMap,
  tap,
  timer
} from 'rxjs';
import { Router } from '@angular/router';
import type { User } from '@shared/models/user.types';
import type { UserPermissionsResponse } from '@app/shared/types';
import type {
  AuthResponse,
  LoginCredentials,
  RefreshTokensRequest,
  RegisterRequest,
  TokensResponse,
  UpdateProfile
} from '../models/auth.types';
import { AuthStore, AUTH_STORAGE_KEY } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import { navigateToLogin } from '../utils/navigate-to-login';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { LocalStorageService } from '@core/services/local-storage.service';

const TOKEN_REFRESH_WINDOW_SECONDS = 60;
const REFRESH_LOCK_NAME = 'auth_token_refresh';

const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly #http = inject(HttpClient);
  readonly #router = inject(Router);
  readonly #authStore = inject(AuthStore);
  readonly #localStorage = inject(LocalStorageService);
  readonly #window = inject(DOCUMENT).defaultView;

  readonly isAuthenticated = this.#authStore.isAuthenticated;

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
          void this.fetchPermissions();
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

  updateProfile(data: UpdateProfile): Observable<User> {
    return this.#http
      .patch<User>(AuthApiEnum.Profile, data)
      .pipe(tap((user) => this.#authStore.updateCurrentUser(user)));
  }

  refreshTokens(): Observable<TokensResponse | null> {
    if (this.#refreshInFlight$) {
      return this.#refreshInFlight$;
    }

    const originalRefreshToken = this.#authStore.getRefreshToken();

    if (!originalRefreshToken) {
      this.#authStore.clearSession();
      return of(null);
    }

    this.#refreshInFlight$ = from(
      this.#acquireRefreshLock(originalRefreshToken)
    ).pipe(
      finalize(() => {
        this.#refreshInFlight$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return this.#refreshInFlight$;
  }

  scheduleTokenRefresh(): void {
    this.#refreshSubscription?.unsubscribe();

    const expiryTime = this.#authStore.getTokenExpiryTime();
    if (!expiryTime) return;

    const now = Date.now();

    // Token already expired — no point in scheduling, let guards/interceptor handle refresh
    if (expiryTime <= now) return;

    const timeToRefresh =
      expiryTime - now - TOKEN_REFRESH_WINDOW_SECONDS * 1000;

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

  getOAuthAccounts(): Observable<{ provider: string; createdAt: string }[]> {
    return this.#http.get<{ provider: string; createdAt: string }[]>(
      AuthApiEnum.OAuthAccounts
    );
  }

  exchangeOAuthData(): Observable<AuthResponse> {
    return this.#http.post<AuthResponse>(
      AuthApiEnum.OAuthExchange,
      {},
      { withCredentials: true }
    );
  }

  initOAuthLink(): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(AuthApiEnum.OAuthLinkInit, {});
  }

  unlinkOAuthAccount(provider: string): Observable<{ message: string }> {
    return this.#http.delete<{ message: string }>(
      `${AuthApiEnum.OAuthAccounts}/${provider}`
    );
  }

  forgotPassword(email: string): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.ForgotPassword,
      { email },
      { context: silentContext() }
    );
  }

  resetPassword(
    token: string,
    password: string
  ): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.ResetPassword,
      { token, password },
      { context: silentContext() }
    );
  }

  verifyEmail(token: string): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.VerifyEmail,
      { token },
      { context: silentContext() }
    );
  }

  resendVerificationEmail(email: string): Observable<{ message: string }> {
    return this.#http.post<{ message: string }>(
      AuthApiEnum.ResendVerification,
      { email },
      { context: silentContext() }
    );
  }

  fetchPermissions(): Promise<void> {
    return firstValueFrom(
      this.#http.get<UserPermissionsResponse>(AuthApiEnum.Permissions, {
        context: silentContext()
      })
    )
      .then((response) => {
        this.#authStore.setRules(response.rules);
      })
      .catch((error) => {
        console.error('Failed to fetch permissions:', error);
      });
  }

  initSession(): void {
    if (this.isAuthenticated()) {
      this.scheduleTokenRefresh();
      void this.fetchPermissions();
    }
  }

  /**
   * Acquires a cross-tab Web Locks API lock before refreshing.
   * Falls back to a direct refresh when the API is unavailable (e.g. SSR, old browsers).
   *
   * `navigator` is accessed via `inject(DOCUMENT).defaultView` (Angular DI) rather
   * than as a bare global, so this works correctly in SSR and test environments.
   */
  #acquireRefreshLock(
    originalRefreshToken: string
  ): Promise<TokensResponse | null> {
    const win = this.#window;

    if (!win || !('locks' in win.navigator)) {
      return this.#doRefresh(originalRefreshToken);
    }

    // Wrap in an explicit Promise to prevent TypeScript from inferring a nested
    // Promise type from LockManager.request's generic overload.
    return new Promise<TokensResponse | null>((resolve, reject) => {
      win.navigator.locks
        .request(REFRESH_LOCK_NAME, async () => {
          try {
            resolve(await this.#doRefresh(originalRefreshToken));
          } catch (err) {
            reject(err);
          }
        })
        .catch(reject);
    });
  }

  /**
   * Performs the token refresh, guarded against cross-tab duplication.
   *
   * If another tab already completed a refresh while this tab was waiting for
   * the lock, the new tokens will already be in localStorage with a different
   * refresh token. In that case we adopt the stored tokens without making an
   * HTTP call.
   */
  async #doRefresh(
    originalRefreshToken: string
  ): Promise<TokensResponse | null> {
    const stored = this.#localStorage.getItem<AuthResponse>(AUTH_STORAGE_KEY);

    if (stored && stored.tokens.refresh_token !== originalRefreshToken) {
      // Another tab already refreshed — adopt their tokens
      this.#authStore.saveAuthResponse(stored);
      this.scheduleTokenRefresh();
      return stored.tokens;
    }

    const request: RefreshTokensRequest = {
      refresh_token: originalRefreshToken
    };

    const response = await firstValueFrom(
      this.#http.post<AuthResponse>(AuthApiEnum.RefreshToken, request, {
        context: silentContext()
      })
    );

    this.#authStore.saveAuthResponse(response);
    this.scheduleTokenRefresh();
    void this.fetchPermissions();
    return response.tokens;
  }
}
