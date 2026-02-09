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
import type { User } from '../../users/models/user.types';
import type {
  AuthResponse,
  LoginCredentials,
  RefreshTokensRequest,
  RegisterRequest,
  TokensResponse
} from '../models/auth.types';
import { TokenService } from './token.service';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';
import { navigateToLogin } from '@features/auth/utils/navigate-to-login';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@features/auth/context-tokens/error-notifications';

const TOKEN_REFRESH_WINDOW_SECONDS = 60;
const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  readonly #http = inject(HttpClient);
  readonly #router = inject(Router);
  readonly #tokenService = inject(TokenService);

  #refreshSubscription?: Subscription;
  #refreshInFlight$: Observable<TokensResponse | null> | null = null;

  readonly user = this.#tokenService.user;
  readonly isAuthenticated = this.#tokenService.isAuthenticated;
  readonly isAdmin = this.#tokenService.isAdmin;

  constructor() {
    if (this.isAuthenticated()) {
      this.#scheduleTokenRefresh();
    }
  }

  isAccessTokenExpired(): boolean {
    return this.#tokenService.isAccessTokenExpired();
  }

  register(registerData: RegisterRequest): Observable<User> {
    return this.#http.post<User>(AuthApiEnum.Register, registerData, {
      context: silentContext()
    });
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.#http
      .post<AuthResponse>(AuthApiEnum.Login, credentials, {
        context: silentContext()
      })
      .pipe(tap((response) => this.#handleAuthentication(response)));
  }

  logout(returnUrl?: string): void {
    this.#refreshSubscription?.unsubscribe();
    this.#refreshInFlight$ = null;

    const completeLogout = () => {
      if (returnUrl) {
        navigateToLogin(this.#router, returnUrl);
      } else {
        void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`]);
      }
    };

    if (this.isAuthenticated()) {
      this.#http
        .post(AuthApiEnum.Logout, {}, { context: silentContext() })
        .pipe(
          finalize(() => {
            this.#tokenService.clearAuth();
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
      .pipe(tap((profile) => this.#tokenService.updateUser(profile)));
  }

  updateCurrentUser(user: User): void {
    this.#tokenService.updateUser(user);
  }

  refreshTokens(): Observable<TokensResponse | null> {
    if (this.#refreshInFlight$) {
      return this.#refreshInFlight$;
    }

    const refreshToken = this.#tokenService.getRefreshToken();
    if (!refreshToken) {
      this.#tokenService.clearAuth();
      return of(null);
    }

    const request: RefreshTokensRequest = { refresh_token: refreshToken };

    this.#refreshInFlight$ = this.#http
      .post<AuthResponse>(AuthApiEnum.RefreshToken, request)
      .pipe(
        tap((response) => this.#handleAuthentication(response)),
        map((response) => response.tokens),
        catchError((error) => {
          this.#tokenService.clearAuth();
          return throwError(() => error);
        }),
        finalize(() => {
          this.#refreshInFlight$ = null;
        }),
        shareReplay(1)
      );

    return this.#refreshInFlight$;
  }

  #scheduleTokenRefresh(): void {
    this.#refreshSubscription?.unsubscribe();

    const expiryTime = this.#tokenService.getTokenExpiryTime();
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

  #handleAuthentication(authResponse: AuthResponse): void {
    this.#tokenService.saveAuthResponse(authResponse);
    this.#scheduleTokenRefresh();
  }
}
