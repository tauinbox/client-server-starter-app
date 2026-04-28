import { computed, inject } from '@angular/core';
import { jwtDecode } from 'jwt-decode';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import type { RawRuleOf } from '@casl/ability';
import { createMongoAbility, subject } from '@casl/ability';
import type { PackRule } from '@casl/ability/extra';
import { unpackRules } from '@casl/ability/extra';
import type {
  RoleResponse,
  UserPermissionsResponse,
  UserResponse
} from '@app/shared/types';
import type { AuthResponse, CustomJwtPayload } from '../models/auth.types';
import type { AppAbility, PermissionCheck } from '../casl/app-ability';
import { LocalStorageService } from '@core/services/local-storage.service';

export const AUTH_USER_KEY = 'auth_user';

type AuthState = {
  accessToken: string | null; // in-memory ONLY — lost on page reload
  user: UserResponse | null; // persisted to localStorage (for reload detection)
  ability: AppAbility | null;
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(() => {
    const storage = inject(LocalStorageService);
    return {
      accessToken: null,
      user: storage.getItem<UserResponse>(AUTH_USER_KEY) ?? null,
      ability: null
    };
  }),
  withComputed((store) => ({
    isAuthenticated: computed(() => store.accessToken() !== null),
    roles: computed<RoleResponse[]>(() => store.user()?.roles ?? [])
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

    function updateCurrentUser(user: UserResponse): void {
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

    function hasPermissions(
      check: PermissionCheck | PermissionCheck[]
    ): boolean {
      const checks = Array.isArray(check) ? check : [check];
      return checks.every(({ action, subject: subjectName, instance }) => {
        const ability = store.ability();
        if (!ability) return false;
        if (instance !== undefined) {
          return ability.can(action, subject(subjectName, instance));
        }
        return ability.can(action, subjectName);
      });
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
      hasPermissions
    };
  })
);
