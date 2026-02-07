import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import {
  BehaviorSubject,
  catchError,
  finalize,
  map,
  of,
  skip,
  take,
  tap
} from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { Router } from '@angular/router';
import type {
  AuthResponse,
  CustomJwtPayload,
  RefreshTokensRequest,
  TokensResponse
} from '../models/auth.types';
import { AUTH_API_V1 } from '@features/auth/services/auth.service';
import type { User } from '@features/users/models/user.types';

const AUTH_TOKENS = 'auth_tokens';

@Injectable({
  providedIn: 'root'
})
export class TokenService {
  readonly #http = inject(HttpClient);
  readonly #router = inject(Router);
  readonly #authTokensSubject = new BehaviorSubject<AuthResponse | null>(
    this.getAuthTokens()
  );
  readonly #isRefreshInProgressSignal = signal<boolean>(false);
  readonly #isAuthenticatedSignal = signal<boolean>(
    !this.isAccessTokenExpired()
  );

  readonly authTokens$ = this.#authTokensSubject.asObservable();
  readonly isAuthenticated = this.#isAuthenticatedSignal.asReadonly();
  readonly isRefreshInProgress = this.#isRefreshInProgressSignal.asReadonly();

  getAuthTokens() {
    let authTokens: AuthResponse | null = null;
    const tokens = localStorage.getItem(AUTH_TOKENS);

    try {
      authTokens = tokens ? (JSON.parse(tokens) as AuthResponse) : null;
    } catch (error) {
      console.error('Unable to parse auth token', error);
    }

    return authTokens;
  }

  getAccessToken(): string | null {
    const response = this.getAuthTokens();
    return response ? response.tokens.access_token : null;
  }

  getRefreshToken(): string | null {
    const response = this.getAuthTokens();
    return response ? response.tokens.refresh_token : null;
  }

  getUserData(): User | null {
    const response = this.getAuthTokens();
    return response ? response.user : null;
  }

  saveTokens(response: AuthResponse): void {
    localStorage.setItem(AUTH_TOKENS, JSON.stringify(response));
    this.#isAuthenticatedSignal.set(true);
  }

  clearTokens(): void {
    localStorage.removeItem(AUTH_TOKENS);
    this.#authTokensSubject.next(null);
    this.#isAuthenticatedSignal.set(false);
    this.#isRefreshInProgressSignal.set(false);
  }

  logout(): void {
    if (this.isAuthenticated()) {
      this.#http
        .post(`${AUTH_API_V1}/logout`, {})
        .pipe(catchError(() => of(null)))
        .subscribe();
    }

    this.clearTokens();
    void this.#router.navigate(['/login']);
  }

  isAccessTokenExpired(): boolean {
    const token = this.getAccessToken();
    if (!token) return true;

    try {
      const decoded = jwtDecode<CustomJwtPayload>(token);
      return decoded.exp ? decoded.exp < Date.now() / 1000 : false;
    } catch (error) {
      return true;
    }
  }

  getTokenExpiryTime(): number | null {
    const token = this.getAccessToken();
    if (!token) return null;

    try {
      const decoded = jwtDecode<CustomJwtPayload>(token);
      return decoded.exp ? decoded.exp * 1000 : null;
    } catch (error) {
      return null;
    }
  }

  getTokenPayload(): CustomJwtPayload | null {
    const token = this.getAccessToken();
    if (!token) return null;

    try {
      return jwtDecode<CustomJwtPayload>(token);
    } catch (error) {
      return null;
    }
  }

  refreshToken(): Observable<TokensResponse | null> {
    if (this.isRefreshInProgress()) {
      return this.authTokens$.pipe(
        skip(1), // Skip current BehaviorSubject value and wait for the fresh one
        take(1),
        map((response) => response?.tokens ?? null)
      );
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      this.clearTokens();
      return of(null);
    }

    const refreshRequest: RefreshTokensRequest = {
      refresh_token: refreshToken
    };

    this.#isRefreshInProgressSignal.set(true);

    return this.#http
      .post<AuthResponse>(`${AUTH_API_V1}/refresh-token`, refreshRequest)
      .pipe(
        tap((response) => {
          this.#authTokensSubject.next(response);
        }),
        map((response) => response.tokens),
        finalize(() => {
          this.#isRefreshInProgressSignal.set(false);
        }),
        catchError(() => {
          this.clearTokens();
          this.#authTokensSubject.next(null);
          return of(null);
        })
      );
  }
}
