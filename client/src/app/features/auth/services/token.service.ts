import { computed, inject, Injectable, signal } from '@angular/core';
import { jwtDecode } from 'jwt-decode';
import type { AuthResponse, CustomJwtPayload } from '../models/auth.types';
import type { User } from '@features/users/models/user.types';
import { StorageService } from '@core/services/storage.service';

const AUTH_STORAGE_KEY = 'auth_storage';

@Injectable({
  providedIn: 'root'
})
export class TokenService {
  readonly #storage = inject(StorageService);

  readonly #authResponse = signal<AuthResponse | null>(this.#readFromStorage());

  readonly user = computed<User | null>(
    () => this.#authResponse()?.user ?? null
  );
  readonly isAuthenticated = computed(() => this.#authResponse() !== null);
  readonly isAdmin = computed(() => this.user()?.isAdmin ?? false);

  getAccessToken(): string | null {
    return this.#authResponse()?.tokens.access_token ?? null;
  }

  getRefreshToken(): string | null {
    return this.#authResponse()?.tokens.refresh_token ?? null;
  }

  saveAuthResponse(response: AuthResponse): void {
    this.#storage.setItem(AUTH_STORAGE_KEY, response);
    this.#authResponse.set(response);
  }

  updateUser(user: User): void {
    const current = this.#authResponse();
    if (!current) return;

    const updated: AuthResponse = { ...current, user };
    this.#storage.setItem(AUTH_STORAGE_KEY, updated);
    this.#authResponse.set(updated);
  }

  clearAuth(): void {
    this.#storage.removeItem(AUTH_STORAGE_KEY);
    this.#authResponse.set(null);
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

  #readFromStorage(): AuthResponse | null {
    return this.#storage.getItem<AuthResponse>(AUTH_STORAGE_KEY);
  }
}
