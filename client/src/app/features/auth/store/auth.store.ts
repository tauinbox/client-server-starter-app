import { computed, inject } from '@angular/core';
import { jwtDecode } from 'jwt-decode';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import { createMongoAbility } from '@casl/ability';
import type { RawRuleOf } from '@casl/ability';
import { unpackRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';
import type { User } from '@shared/models/user.types';
import type { AuthResponse, CustomJwtPayload } from '../models/auth.types';
import type { AppAbility, Actions } from '../casl/app-ability';
import { SUBJECT_MAP } from '../casl/app-ability';
import { LocalStorageService } from '@core/services/local-storage.service';

export const AUTH_STORAGE_KEY = 'auth_storage';

type AuthState = {
  authResponse: AuthResponse | null;
  ability: AppAbility | null;
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(() => {
    const storage = inject(LocalStorageService);
    return {
      authResponse: storage.getItem<AuthResponse>(AUTH_STORAGE_KEY) ?? null,
      ability: null
    };
  }),
  withComputed((store) => ({
    user: computed<User | null>(() => store.authResponse()?.user ?? null),
    isAuthenticated: computed(() => store.authResponse() !== null),
    /**
     * For displaying the current user's role label only.
     * Use hasPermission() for all access control decisions.
     */
    isAdmin: computed(
      () => store.authResponse()?.user?.roles?.includes('admin') ?? false
    ),
    roles: computed<string[]>(() => store.authResponse()?.user?.roles ?? [])
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
      patchState(store, { authResponse: null, ability: null });
    }

    function setRules(rules: unknown): void {
      const ability = createMongoAbility<AppAbility>(
        unpackRules(rules as PackRule<RawRuleOf<AppAbility>>[])
      );
      patchState(store, { ability });
    }

    function hasPermission(permission: string): boolean {
      const [resource, action] = permission.split(':');
      const subject = SUBJECT_MAP[resource];
      if (!subject) return false;
      return store.ability()?.can(action as Actions, subject) ?? false;
    }

    return {
      getAccessToken,
      getRefreshToken,
      isAccessTokenExpired,
      getTokenExpiryTime,
      saveAuthResponse,
      updateCurrentUser,
      clearSession,
      setRules,
      hasPermission
    };
  })
);
