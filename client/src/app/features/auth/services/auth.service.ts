import { inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  catchError,
  Observable,
  Subscription,
  switchMap,
  tap,
  throwError,
  timer
} from 'rxjs';
import { User } from '../../users/models/user.types';
import {
  AuthResponse,
  LoginCredentials,
  RegisterRequest
} from '../models/auth.types';
import { TokenService } from './token.service';

export const AUTH_API_V1 = 'api/v1/auth';
const TOKEN_REFRESH_WINDOW_SECONDS = 60;

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  readonly #http = inject(HttpClient);
  readonly #tokenService = inject(TokenService);

  #refreshSubscription?: Subscription;

  readonly #currentUserSignal = signal<User | null>(null);
  readonly #isAdminSignal = signal<boolean>(false);

  readonly user = this.#currentUserSignal.asReadonly();
  readonly isAuthenticated = this.#tokenService.isAuthenticated;
  readonly isAdmin = this.#isAdminSignal.asReadonly();

  constructor() {
    const user = this.#tokenService.getUserData();

    if (user) {
      this.updateUserData(user);
    }

    this.#tokenService.authTokens$
      .pipe(takeUntilDestroyed())
      .subscribe((authResponse) => {
        if (authResponse) {
          this.handleAuthentication(authResponse);
        }
      });
  }

  register(registerData: RegisterRequest): Observable<User> {
    return this.#http
      .post<User>(`${AUTH_API_V1}/register`, registerData)
      .pipe(catchError(this.handleError));
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.#http
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
    this.#refreshSubscription?.unsubscribe();
    this.#tokenService.logout();
    this.#currentUserSignal.set(null);
    this.#isAdminSignal.set(false);
  }

  getProfile(): Observable<User> {
    return this.#http.get<User>(`${AUTH_API_V1}/profile`).pipe(
      tap((profile) => {
        this.#currentUserSignal.update(
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

  private scheduleTokenRefresh(): void {
    this.#refreshSubscription?.unsubscribe();

    const expiryTime = this.#tokenService.getTokenExpiryTime();
    if (!expiryTime) return;

    const timeToRefresh =
      expiryTime - Date.now() - TOKEN_REFRESH_WINDOW_SECONDS * 1000;

    if (timeToRefresh <= 0) {
      this.#refreshSubscription = this.#tokenService.refreshToken().subscribe();
      return;
    }

    this.#refreshSubscription = timer(timeToRefresh)
      .pipe(switchMap(() => this.#tokenService.refreshToken()))
      .subscribe();
  }

  private updateUserData(user: User): void {
    this.#currentUserSignal.set(user);
    this.#isAdminSignal.set(user.isAdmin);
  }

  private handleAuthentication(authResponse: AuthResponse): void {
    this.#tokenService.saveTokens(authResponse);
    this.updateUserData(authResponse.user);
    this.scheduleTokenRefresh();
  }

  private handleError = (error: HttpErrorResponse) => {
    let errorMessage: string;
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error: ${error.error.message}`;
    } else {
      errorMessage = error.error?.message || `Error Code: ${error.status}`;
    }
    return throwError(() => new Error(errorMessage));
  };
}
