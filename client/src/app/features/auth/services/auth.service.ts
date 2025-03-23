import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  catchError,
  Observable,
  switchMap,
  take,
  tap,
  throwError,
  timer
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { User } from '../../users/models/user.types';
import {
  AuthResponse,
  LoginCredentials,
  RegisterRequest
} from '../models/auth.types';
import { TokenService } from './token.service';

export const AUTH_API_V1 = 'api/v1/auth';
const TOKEN_REFRESH_WINDOW = 60;

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);
  private tokenService = inject(TokenService);

  private currentUserSignal = signal<User | null>(null);
  private isAdminSignal = signal<boolean>(false);

  readonly user = this.currentUserSignal.asReadonly();
  readonly isAuthenticated = this.tokenService.isAuthenticated;
  readonly isAdmin = this.isAdminSignal.asReadonly();

  constructor() {
    this.tokenService.refreshToken$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((authResponse) => {
        if (authResponse) {
          this.handleAuthentication(authResponse);
        }
      });

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
          return throwError(
            () => new Error(error.error?.message || 'Invalid credentials')
          );
        })
      );
  }

  logout(): void {
    this.tokenService.logout();
    this.currentUserSignal.set(null);
    this.isAdminSignal.set(false);
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

  private setupTokenRefresh(): void {
    const expiryTime = this.tokenService.getTokenExpiryTime();
    if (!expiryTime) return;

    const timeToRefresh = expiryTime - Date.now() - TOKEN_REFRESH_WINDOW * 1000;

    if (timeToRefresh <= 0) {
      this.tokenService.refreshToken().pipe(take(1)).subscribe();
      return;
    }

    timer(timeToRefresh)
      .pipe(
        take(1),
        switchMap(() => this.tokenService.refreshToken().pipe(take(1))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private updateUserData(user: User): void {
    this.currentUserSignal.set(user);
    this.isAdminSignal.set(user.isAdmin);
  }

  private updateUserFromLocalStorage(): void {
    const user = this.tokenService.getUserData();

    if (user) {
      this.updateUserData(user);
    }
  }

  private handleAuthentication(authResponse: AuthResponse): void {
    this.tokenService.saveTokens(authResponse);
    this.updateUserData(authResponse.user);
    this.setupTokenRefresh();
  }

  private checkAuthStatus(): void {
    if (this.tokenService.isTokenExpired()) {
      const refreshToken = this.tokenService.getRefreshToken();
      if (refreshToken) {
        this.tokenService
          .refreshToken()
          .pipe(take(1))
          .subscribe({
            error: () => this.tokenService.clearTokens()
          });
        return;
      }

      this.tokenService.clearTokens();
      return;
    }

    this.updateUserFromLocalStorage();
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
