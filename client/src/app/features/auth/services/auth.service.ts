import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import type { Observable, Subscription } from 'rxjs';
import { finalize, map, of, shareReplay, switchMap, tap, timer } from 'rxjs';
import { Router } from '@angular/router';
import type { User } from '@shared/models/user.types';
import type {
  AuthResponse,
  LoginCredentials,
  RefreshTokensRequest,
  RegisterRequest,
  TokensResponse,
  UpdateProfile
} from '../models/auth.types';
import { AuthStore } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import { navigateToLogin } from '../utils/navigate-to-login';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';

const TOKEN_REFRESH_WINDOW_SECONDS = 60;

const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly #http = inject(HttpClient);
  readonly #router = inject(Router);
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

  updateProfile(data: UpdateProfile): Observable<User> {
    return this.#http
      .patch<User>(AuthApiEnum.Profile, data)
      .pipe(tap((user) => this.#authStore.updateCurrentUser(user)));
  }

  refreshTokens(): Observable<TokensResponse | null> {
    if (this.#refreshInFlight$) {
      return this.#refreshInFlight$;
    }

    const refreshToken = this.#authStore.getRefreshToken();

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

  initSession(): void {
    if (this.#authStore.isAuthenticated()) {
      this.scheduleTokenRefresh();
    }
  }
}
