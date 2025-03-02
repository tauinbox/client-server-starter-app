import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { User } from '../../users/models/user.types';
import { AuthResponse, CustomJwtPayload, LoginCredentials, RegisterRequest } from '../models/auth.types';

export const AUTH_API_V1 = 'api/v1/auth';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private readonly TOKEN_KEY = 'auth_token';
  private readonly USER_KEY = 'auth_user';

  private currentUserSignal = signal<User | null>(null);
  private isAuthenticatedSignal = signal<boolean>(false);
  private isAdminSignal = signal<boolean>(false);

  readonly user = this.currentUserSignal.asReadonly();
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();
  readonly isAdmin = this.isAdminSignal.asReadonly();

  constructor() {
    this.checkToken();
  }

  register(registerData: RegisterRequest): Observable<User> {
    return this.http.post<User>(`${AUTH_API_V1}/register`, registerData);
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${AUTH_API_V1}/login`, credentials)
      .pipe(
        tap(response => this.handleAuthentication(response)),
        catchError(error => {
          console.error('Login failed', error);
          return throwError(() => new Error('Invalid credentials'));
        })
      );
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.currentUserSignal.set(null);
    this.isAuthenticatedSignal.set(false);
    this.isAdminSignal.set(false);
    void this.router.navigate(['/login']);
  }

  getProfile(): Observable<User> {
    return this.http.get<User>(`${AUTH_API_V1}/profile`).pipe(
      tap(profile => {
        // TODO: replace with profile data (it should be different entity, but now they are the same)
        this.currentUserSignal.update(user => ({...(user ?? {}), ...profile}))
      })
    );
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  isTokenExpired(): boolean {
    const token = this.getToken();
    if (!token) return true;

    try {
      const decoded = jwtDecode<CustomJwtPayload>(token);
      return decoded.exp ? decoded.exp < Date.now() / 1000 : false;
    } catch (error) {
      return true;
    }
  }

  private handleAuthentication(authResponse: AuthResponse): void {
    localStorage.setItem(this.TOKEN_KEY, authResponse.access_token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(authResponse.user));

    this.currentUserSignal.set(authResponse.user);
    this.isAuthenticatedSignal.set(true);
    this.isAdminSignal.set(authResponse.user.isAdmin);
  }

  private checkToken(): void {
    const token = this.getToken();
    if (!token || this.isTokenExpired()) {
      this.logout();
      return;
    }

    const userJson = localStorage.getItem(this.USER_KEY);
    if (userJson) {
      try {
        const user = JSON.parse(userJson) as User;
        this.currentUserSignal.set(user);
        this.isAuthenticatedSignal.set(true);
        this.isAdminSignal.set(user.isAdmin);
      } catch (error) {
        this.logout();
      }
    }
  }
}
