import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
import { AUTH_API_V1 } from '@features/auth/constants/auth-api.const';

const TOKEN_REFRESH_WINDOW_SECONDS = 60;

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  readonly #http = inject(HttpClient);
  readonly #router = inject(Router);
  readonly #tokenService = inject(TokenService);

  #refreshSubscription?: Subscription;
  #refreshInFlight$: Observable<TokensResponse | null> | null = null;

  readonly #currentUserSignal = signal<User | null>(null);

  readonly user = this.#currentUserSignal.asReadonly();
  readonly isAuthenticated = this.#tokenService.isAuthenticated;
  readonly isAdmin = computed(
    () => this.#currentUserSignal()?.isAdmin ?? false
  );

  constructor() {
    const storedUser = this.#tokenService.getUserData();

    if (storedUser) {
      this.#currentUserSignal.set(storedUser);
      this.#scheduleTokenRefresh();
    }
  }

  register(registerData: RegisterRequest): Observable<User> {
    return this.#http.post<User>(`${AUTH_API_V1}/register`, registerData);
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.#http
      .post<AuthResponse>(`${AUTH_API_V1}/login`, credentials)
      .pipe(tap((response) => this.#handleAuthentication(response)));
  }

  logout(): void {
    this.#refreshSubscription?.unsubscribe();

    if (this.isAuthenticated()) {
      this.#http
        .post(`${AUTH_API_V1}/logout`, {})
        .pipe(catchError(() => of(null)))
        .subscribe();
    }

    this.#tokenService.clearTokens();
    this.#currentUserSignal.set(null);
    this.#refreshInFlight$ = null;
    void this.#router.navigate(['/login']);
  }

  getProfile(): Observable<User> {
    return this.#http
      .get<User>(`${AUTH_API_V1}/profile`)
      .pipe(tap((profile) => this.#currentUserSignal.set(profile)));
  }

  refreshTokens(): Observable<TokensResponse | null> {
    if (this.#refreshInFlight$) {
      return this.#refreshInFlight$;
    }

    const refreshToken = this.#tokenService.getRefreshToken();
    if (!refreshToken) {
      this.#tokenService.clearTokens();
      return of(null);
    }

    const request: RefreshTokensRequest = { refresh_token: refreshToken };

    this.#refreshInFlight$ = this.#http
      .post<AuthResponse>(`${AUTH_API_V1}/refresh-token`, request)
      .pipe(
        tap((response) => this.#handleAuthentication(response)),
        map((response) => response.tokens),
        catchError((error) => {
          this.#tokenService.clearTokens();
          this.#currentUserSignal.set(null);
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

    if (timeToRefresh <= 0) {
      this.#refreshSubscription = this.refreshTokens().subscribe();
      return;
    }

    this.#refreshSubscription = timer(timeToRefresh)
      .pipe(switchMap(() => this.refreshTokens()))
      .subscribe();
  }

  #handleAuthentication(authResponse: AuthResponse): void {
    this.#tokenService.saveTokens(authResponse);
    this.#currentUserSignal.set(authResponse.user);
    this.#scheduleTokenRefresh();
  }
}
