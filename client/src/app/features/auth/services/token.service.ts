import { Injectable, signal } from '@angular/core';
import { jwtDecode } from 'jwt-decode';
import type { AuthResponse, CustomJwtPayload } from '../models/auth.types';
import type { User } from '@features/users/models/user.types';

const AUTH_TOKENS = 'auth_tokens';

@Injectable({
  providedIn: 'root'
})
export class TokenService {
  readonly #authResponse = signal<AuthResponse | null>(this.#readFromStorage());
  readonly #isAuthenticated = signal<boolean>(!this.isAccessTokenExpired());

  readonly authResponse = this.#authResponse.asReadonly();
  readonly isAuthenticated = this.#isAuthenticated.asReadonly();

  getAccessToken(): string | null {
    return this.#authResponse()?.tokens.access_token ?? null;
  }

  getRefreshToken(): string | null {
    return this.#authResponse()?.tokens.refresh_token ?? null;
  }

  getUserData(): User | null {
    return this.#authResponse()?.user ?? null;
  }

  saveTokens(response: AuthResponse): void {
    localStorage.setItem(AUTH_TOKENS, JSON.stringify(response));
    this.#authResponse.set(response);
    this.#isAuthenticated.set(true);
  }

  clearTokens(): void {
    localStorage.removeItem(AUTH_TOKENS);
    this.#authResponse.set(null);
    this.#isAuthenticated.set(false);
  }

  isAccessTokenExpired(): boolean {
    const token = this.getAccessToken();
    if (!token) return true;

    try {
      const decoded = jwtDecode<CustomJwtPayload>(token);
      return decoded.exp ? decoded.exp < Date.now() / 1000 : false;
    } catch {
      return true;
    }
  }

  getTokenExpiryTime(): number | null {
    const token = this.getAccessToken();
    if (!token) return null;

    try {
      const decoded = jwtDecode<CustomJwtPayload>(token);
      return decoded.exp ? decoded.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  getTokenPayload(): CustomJwtPayload | null {
    const token = this.getAccessToken();
    if (!token) return null;

    try {
      return jwtDecode<CustomJwtPayload>(token);
    } catch {
      return null;
    }
  }

  #readFromStorage(): AuthResponse | null {
    const raw = localStorage.getItem(AUTH_TOKENS);

    try {
      return raw ? (JSON.parse(raw) as AuthResponse) : null;
    } catch {
      console.error('Unable to parse auth tokens from storage');
      return null;
    }
  }
}
