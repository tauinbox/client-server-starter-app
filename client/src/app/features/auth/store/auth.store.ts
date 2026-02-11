import { computed, inject } from '@angular/core';
import { jwtDecode } from 'jwt-decode';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import type { User } from '@features/users/models/user.types';
import type { AuthResponse, CustomJwtPayload } from '../models/auth.types';
import { LocalStorageService } from '@core/services/local-storage.service';

export const AUTH_STORAGE_KEY = 'auth_storage';

type AuthState = {
  authResponse: AuthResponse | null;
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(() => {
    const storage = inject(LocalStorageService);
    return {
      authResponse: storage.getItem<AuthResponse>(AUTH_STORAGE_KEY) ?? null
    };
  }),
  withComputed((store) => ({
    user: computed<User | null>(() => store.authResponse()?.user ?? null),
    isAuthenticated: computed(() => store.authResponse() !== null),
    isAdmin: computed(() => store.authResponse()?.user?.isAdmin ?? false)
  })),
  withMethods((store) => {
    const storage = inject(LocalStorageService);

    function getAccessToken(): string | null {
      return store.authResponse()?.tokens.access_token ?? null;
    }

    function getRefreshToken(): string | null {
      return store.authResponse()?.tokens.refresh_token ?? null;
    }

    function isAccessTokenExpired(): boolean {
      const token = getAccessToken();
      if (!token) return true;

      try {
        const decoded = jwtDecode<CustomJwtPayload>(token);
        return decoded.exp ? decoded.exp < Date.now() / 1000 : false;
      } catch {
        return true;
      }
    }

    function getTokenExpiryTime(): number | null {
      const token = getAccessToken();
      if (!token) return null;

      try {
        const decoded = jwtDecode<CustomJwtPayload>(token);
        return decoded.exp ? decoded.exp * 1000 : null;
      } catch {
        return null;
      }
    }

    function saveAuthResponse(response: AuthResponse): void {
      storage.setItem(AUTH_STORAGE_KEY, response);
      patchState(store, { authResponse: response });
    }

    function updateCurrentUser(user: User): void {
      const current = store.authResponse();
      if (!current) return;

      const updated: AuthResponse = { ...current, user };
      storage.setItem(AUTH_STORAGE_KEY, updated);
      patchState(store, { authResponse: updated });
    }

    function clearSession(): void {
      storage.removeItem(AUTH_STORAGE_KEY);
      patchState(store, { authResponse: null });
    }

    return {
      getAccessToken,
      getRefreshToken,
      isAccessTokenExpired,
      getTokenExpiryTime,
      saveAuthResponse,
      updateCurrentUser,
      clearSession
    };
  })
);
