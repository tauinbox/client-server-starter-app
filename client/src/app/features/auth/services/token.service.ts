import { Injectable, signal } from '@angular/core';
import { jwtDecode } from 'jwt-decode';
import { BehaviorSubject } from 'rxjs';
import { CustomJwtPayload, TokensResponse } from '../models/auth.types';

const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';

@Injectable({
  providedIn: 'root'
})
export class TokenService {
  private refreshTokenSubject = new BehaviorSubject<TokensResponse | null>(
    null
  );

  private refreshInProgress = false;

  refreshToken$ = this.refreshTokenSubject.asObservable();

  private isAuthenticatedSignal = signal<boolean>(false);
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  constructor() {
    this.isAuthenticatedSignal.set(!this.isTokenExpired());
  }

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  saveTokens(tokens: TokensResponse): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
    this.refreshTokenSubject.next(tokens);
    this.isAuthenticatedSignal.set(true);
  }

  clearTokens(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    this.refreshTokenSubject.next(null);
    this.isAuthenticatedSignal.set(false);
    this.refreshInProgress = false;
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

  getTokenPayload(): CustomJwtPayload | null {
    const token = this.getAccessToken();
    if (!token) return null;

    try {
      return jwtDecode<CustomJwtPayload>(token);
    } catch (error) {
      return null;
    }
  }

  startRefreshProcess() {
    this.refreshInProgress = true;
    this.refreshTokenSubject.next({} as TokensResponse);
  }

  endRefreshProcess(tokens: TokensResponse | null) {
    this.refreshInProgress = false;
    this.refreshTokenSubject.next(tokens);
  }

  isRefreshInProgress(): boolean {
    return this.refreshInProgress;
  }
}
