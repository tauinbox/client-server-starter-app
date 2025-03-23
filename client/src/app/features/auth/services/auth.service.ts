import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  catchError,
  map,
  Observable,
  of,
  switchMap,
  tap,
  throwError,
  timer
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { User } from '../../users/models/user.types';
import {
  AuthResponse,
  LoginCredentials,
  RefreshTokensRequest,
  RegisterRequest,
  TokensResponse
} from '../models/auth.types';
import { TokenService } from './token.service';

export const AUTH_API_V1 = 'api/v1/auth';
const USER_KEY = 'auth_user';
const TOKEN_REFRESH_WINDOW = 60; // seconds before expiry to refresh token

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private tokenService = inject(TokenService);

  private currentUserSignal = signal<User | null>(null);
  private isAdminSignal = signal<boolean>(false);

  readonly user = this.currentUserSignal.asReadonly();
  readonly isAuthenticated = this.tokenService.isAuthenticated;
  readonly isAdmin = this.isAdminSignal.asReadonly();

  constructor() {
    this.checkAuthStatus();
  }

  register(registerData: RegisterRequest): Observable<User> {
    return this.http
      .post<User>(`${AUTH_API_V1}/register`, registerData)
      .pipe(catchError(this.handleError));
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${AUTH_API_V1}/login`, credentials)
      .pipe(
        tap((response) => this.handleAuthentication(response)),
        catchError((error: HttpErrorResponse) => {
          console.error('Login failed', error);
          return throwError(
            () => new Error(error.error?.message || 'Invalid credentials')
          );
        })
      );
  }

  logout(): void {
    if (this.isAuthenticated()) {
      this.http
        .post(`${AUTH_API_V1}/logout`, {})
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe();
    }

    this.clearAuthData();
    void this.router.navigate(['/login']);
  }

  getProfile(): Observable<User> {
    return this.http.get<User>(`${AUTH_API_V1}/profile`).pipe(
      tap((profile) => {
        this.currentUserSignal.update(
          (user) =>
            ({
              ...(user ?? {}),
              ...profile
            }) as User
        );
      }),
      catchError(this.handleError)
    );
  }

  setupTokenRefresh(): void {
    const expiryTime = this.tokenService.getTokenExpiryTime();
    if (!expiryTime) return;

    const timeToRefresh = expiryTime - Date.now() - TOKEN_REFRESH_WINDOW * 1000;

    if (timeToRefresh <= 0) {
      this.refreshToken().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      return;
    }

    timer(timeToRefresh)
      .pipe(
        switchMap(() => {
          return this.refreshToken();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  refreshToken(): Observable<TokensResponse | null> {
    if (this.tokenService.isRefreshInProgress()) {
      return this.tokenService.refreshToken$;
    }

    const refreshToken = this.tokenService.getRefreshToken();
    if (!refreshToken) {
      this.logout();
      return of(null);
    }

    const refreshRequest: RefreshTokensRequest = {
      refresh_token: refreshToken
    };

    this.tokenService.startRefreshProcess();

    return this.http
      .post<AuthResponse>(`${AUTH_API_V1}/refresh-token`, refreshRequest)
      .pipe(
        tap((response) => {
          this.handleAuthentication(response);
          this.tokenService.endRefreshProcess(response.tokens);
        }),
        map((response) => response.tokens),
        catchError((error: HttpErrorResponse) => {
          this.tokenService.endRefreshProcess(null);
          this.logout();
          return of(null);
        })
      );
  }

  private handleAuthentication(authResponse: AuthResponse): void {
    this.tokenService.saveTokens(authResponse.tokens);
    localStorage.setItem(USER_KEY, JSON.stringify(authResponse.user));

    this.currentUserSignal.set(authResponse.user);
    this.isAdminSignal.set(authResponse.user.isAdmin);

    this.setupTokenRefresh();
  }

  private checkAuthStatus(): void {
    if (this.tokenService.isTokenExpired()) {
      const refreshToken = this.tokenService.getRefreshToken();
      if (refreshToken) {
        this.refreshToken()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe();
        return;
      }

      this.clearAuthData();
      return;
    }

    const userJson = localStorage.getItem(USER_KEY);
    if (userJson) {
      try {
        const user = JSON.parse(userJson) as User;
        this.currentUserSignal.set(user);
        this.isAdminSignal.set(user.isAdmin);

        this.setupTokenRefresh();
      } catch (error) {
        this.clearAuthData();
      }
    }
  }

  private clearAuthData(): void {
    this.tokenService.clearTokens();
    localStorage.removeItem(USER_KEY);
    this.currentUserSignal.set(null);
    this.isAdminSignal.set(false);
  }

  private handleError(error: HttpErrorResponse) {
    let errorMessage;

    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error: ${error.error.message}`;
    } else {
      errorMessage = error.error?.message || `Error Code: ${error.status}`;
    }

    return throwError(() => new Error(errorMessage));
  }
}
