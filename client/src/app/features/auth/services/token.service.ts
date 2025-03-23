import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  BehaviorSubject,
  catchError,
  finalize,
  map,
  Observable,
  of,
  tap
} from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { Router } from '@angular/router';
import {
  AuthResponse,
  CustomJwtPayload,
  RefreshTokensRequest,
  TokensResponse
} from '../models/auth.types';
import { AUTH_API_V1 } from '@features/auth/services/auth.service';
import { User } from '@features/users/models/user.types';

const AUTH_TOKENS = 'auth_tokens';

export const USER_KEY = 'auth_user';

@Injectable({
  providedIn: 'root'
})
export class TokenService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private refreshInProgress = false;
  private authTokensSubject = new BehaviorSubject<AuthResponse | null>(
    this.getAuthTokens()
  );

  refreshToken$ = this.authTokensSubject.asObservable();

  private isAuthenticatedSignal = signal<boolean>(false);
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  constructor() {
    this.isAuthenticatedSignal.set(!this.isTokenExpired());
  }

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
    this.isAuthenticatedSignal.set(true);
  }

  clearTokens(): void {
    localStorage.removeItem(AUTH_TOKENS);
    this.authTokensSubject.next(null);
    this.isAuthenticatedSignal.set(false);
    this.refreshInProgress = false;
  }

  logout(): void {
    if (this.isAuthenticated()) {
      this.http
        .post(`${AUTH_API_V1}/logout`, {})
        .pipe(catchError(() => of(null)))
        .subscribe();
    }

    this.clearTokens();
    void this.router.navigate(['/login']);
  }

  isTokenExpired(): boolean {
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

  isRefreshInProgress(): boolean {
    return this.refreshInProgress;
  }

  refreshToken(): Observable<TokensResponse | null> {
    if (this.refreshInProgress) {
      return this.refreshToken$.pipe(
        map((response) => response?.tokens || null)
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

    this.refreshInProgress = true;

    return this.http
      .post<AuthResponse>(`${AUTH_API_V1}/refresh-token`, refreshRequest)
      .pipe(
        tap((response) => {
          this.saveTokens(response);
          this.authTokensSubject.next(response);
        }),
        map((response) => response.tokens),
        finalize(() => {
          this.refreshInProgress = false;
        }),
        catchError((error: HttpErrorResponse) => {
          this.clearTokens();
          this.authTokensSubject.next(null);
          return of(null);
        })
      );
  }
}
