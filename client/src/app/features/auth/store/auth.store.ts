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
import type { UserPermissionsResponse } from '@app/shared/types/role.types';
import type { AuthResponse, CustomJwtPayload } from '../models/auth.types';
import type { AppAbility, Actions, Subjects } from '../casl/app-ability';
import { LocalStorageService } from '@core/services/local-storage.service';

export const AUTH_USER_KEY = 'auth_user';

type AuthState = {
  accessToken: string | null; // in-memory ONLY — lost on page reload
  user: User | null; // persisted to localStorage (for reload detection)
  ability: AppAbility | null;
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(() => {
    const storage = inject(LocalStorageService);
    return {
      accessToken: null,
      user: storage.getItem<User>(AUTH_USER_KEY) ?? null,
      ability: null
    };
  }),
  withComputed((store) => ({
    user: computed<User | null>(() => store.user()),
    isAuthenticated: computed(() => store.accessToken() !== null),
    /**
     * For displaying the current user's role label only.
     * Use hasPermission() for all access control decisions.
     */
    isAdmin: computed(() => store.user()?.roles?.includes('admin') ?? false),
    roles: computed<string[]>(() => store.user()?.roles ?? [])
  })),
  withMethods((store) => {
    const storage = inject(LocalStorageService);

    function getAccessToken(): string | null {
      return store.accessToken();
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
      storage.setItem(AUTH_USER_KEY, response.user);
      patchState(store, {
        accessToken: response.tokens.access_token,
        user: response.user
      });
    }

    function updateCurrentUser(user: User): void {
      storage.setItem(AUTH_USER_KEY, user);
      patchState(store, { user });
    }

    function clearSession(): void {
      storage.removeItem(AUTH_USER_KEY);
      patchState(store, { accessToken: null, user: null, ability: null });
    }

    function hasPersistedUser(): boolean {
      return store.user() !== null;
    }

    function setRules(rules: UserPermissionsResponse['rules']): void {
      if (!Array.isArray(rules) || !rules.every(Array.isArray)) {
        return;
      }
      // Safe cast: validation above guarantees rules is unknown[][]
      // which matches PackRule<RawRuleOf<AppAbility>>[] structure
      const ability = createMongoAbility<AppAbility>(
        unpackRules(rules as PackRule<RawRuleOf<AppAbility>>[])
      );
      patchState(store, { ability });
    }

    function hasPermission(action: Actions, subject: Subjects): boolean {
      return store.ability()?.can(action, subject) ?? false;
    }

    return {
      getAccessToken,
      isAccessTokenExpired,
      getTokenExpiryTime,
      saveAuthResponse,
      updateCurrentUser,
      clearSession,
      hasPersistedUser,
      setRules,
      hasPermission
    };
  })
);
