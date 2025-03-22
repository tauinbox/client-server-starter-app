import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  BehaviorSubject,
  catchError,
  map,
  Observable,
  of,
  switchMap,
  tap,
  throwError,
  timer
} from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { User } from '../../users/models/user.types';
import {
  AuthResponse,
  CustomJwtPayload,
  LoginCredentials,
  RefreshTokenRequest,
  RegisterRequest,
  TokensResponse
} from '../models/auth.types';

export const AUTH_API_V1 = 'api/v1/auth';

const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const USER_KEY = 'auth_user';
const TOKEN_REFRESH_WINDOW = 60; // seconds before expiry to refresh token

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  private currentUserSignal = signal<User | null>(null);
  private isAuthenticatedSignal = signal<boolean>(false);
  private isAdminSignal = signal<boolean>(false);
  private refreshTokenSubject = new BehaviorSubject<TokensResponse | null>(
    null
  );

  readonly user = this.currentUserSignal.asReadonly();
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();
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
    // Try to call the logout endpoint if we're authenticated
    if (this.isAuthenticatedSignal()) {
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

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
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
      return decoded.exp ? decoded.exp * 1000 : null; // Convert to milliseconds
    } catch (error) {
      return null;
    }
  }

  setupTokenRefresh(): void {
    const expiryTime = this.getTokenExpiryTime();
    if (!expiryTime) return;

    const timeToRefresh = expiryTime - Date.now() - TOKEN_REFRESH_WINDOW * 1000;
    if (timeToRefresh <= 0) {
      // Token is about to expire or has expired, refresh immediately
      this.refreshToken().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      return;
    }

    // Schedule refresh before token expires
    timer(timeToRefresh)
      .pipe(
        switchMap(() => this.refreshToken()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  refreshToken(): Observable<TokensResponse | null> {
    // If we already have a refresh in progress, return the subject
    if (this.refreshTokenSubject.value !== null) {
      return this.refreshTokenSubject.asObservable();
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      this.logout();
      return of(null);
    }

    const refreshRequest: RefreshTokenRequest = {
      refresh_token: refreshToken
    };

    // Use an empty object as a pending state marker
    this.refreshTokenSubject.next({} as TokensResponse);

    return this.http
      .post<AuthResponse>(`${AUTH_API_V1}/refresh-token`, refreshRequest)
      .pipe(
        tap((response) => {
          this.handleAuthentication(response);
        }),
        map((response) => response.tokens), // Map the AuthResponse to TokensResponse
        tap((tokens) => {
          if (tokens) {
            this.refreshTokenSubject.next(tokens);
          }
        }),
        catchError((error) => {
          this.refreshTokenSubject.next(null);
          this.logout(); // Token refresh failed, force logout
          return of(null);
        })
      );
  }

  private handleAuthentication(authResponse: AuthResponse): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, authResponse.tokens.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, authResponse.tokens.refresh_token);
    localStorage.setItem(USER_KEY, JSON.stringify(authResponse.user));

    this.currentUserSignal.set(authResponse.user);
    this.isAuthenticatedSignal.set(true);
    this.isAdminSignal.set(authResponse.user.isAdmin);

    this.setupTokenRefresh();
  }

  private checkAuthStatus(): void {
    if (this.isTokenExpired()) {
      // Try to refresh the token if we have a refresh token
      const refreshToken = this.getRefreshToken();
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
        this.isAuthenticatedSignal.set(true);
        this.isAdminSignal.set(user.isAdmin);

        this.setupTokenRefresh();
      } catch (error) {
        this.clearAuthData();
      }
    }
  }

  private clearAuthData(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.currentUserSignal.set(null);
    this.isAuthenticatedSignal.set(false);
    this.isAdminSignal.set(false);
    this.refreshTokenSubject.next(null);
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
