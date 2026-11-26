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
import {
  HOME_DATA_REGION,
  isDataRegion,
  type DataRegion
} from '@app/shared/constants';
import type { AuthResponse, CustomJwtPayload } from '../models/auth.types';
import type { AppAbility, PermissionCheck } from '../casl/app-ability';
import { ADMIN_PANEL_CHECKS } from '../casl/admin-panel-checks';
import { LocalStorageService } from '@core/services/local-storage.service';
import { isPersistedUser } from './storage-guards';

export const AUTH_USER_KEY = 'auth_user';
// The region of the persisted session: the refresh after a reload goes to its
// API host. It cannot come from `residenceCountry`, which staff and older
// accounts do not have. A missing or unknown value is the home region.
export const AUTH_REGION_KEY = 'auth_region';

const SUPER_TARGET_DENY: RawRuleOf<AppAbility> = {
  action: ['update', 'delete'],
  subject: 'User',
  conditions: { roles: { $elemMatch: { isSuper: true } } },
  inverted: true
};

type AuthState = {
  accessToken: string | null; // in-memory ONLY — lost on page reload
  user: UserResponse | null; // persisted to localStorage (for reload detection)
  // The region whose API holds the session, persisted with the user.
  region: DataRegion;
  ability: AppAbility | null;
  // Server policy, refreshed with the rules. Never persisted: a stale copy
  // would either gate a session the server admits or open one it refuses.
  mfaMandatory: boolean;
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(() => {
    const storage = inject(LocalStorageService);

    return {
      accessToken: null,
      user: storage.getItem(AUTH_USER_KEY, isPersistedUser) ?? null,
      region:
        storage.getItem(AUTH_REGION_KEY, isDataRegion) ?? HOME_DATA_REGION,
      ability: null,
      mfaMandatory: false
    };
  }),
  withComputed((store) => ({
    isAuthenticated: computed(() => store.accessToken() !== null),
    roles: computed<RoleResponse[]>(() => store.user()?.roles ?? []),
    /**
     * True while the account owes the second factor its role requires. The
     * protected routes answer such a session with 403, so the client sends it
     * to the enrolment card instead of a denied page.
     */
    mustEnrolMfa: computed(
      () => store.mfaMandatory() && store.user()?.mfaEnabled === false
    ),
    /**
     * True while a user of the service has no declared country of residence.
     * The guards send such a session to the residence page before any other
     * page. Staff (an account that can open the admin panel) works in every
     * region, so the declaration does not apply to it.
     */
    mustDeclareResidence: computed(() => {
      if (store.user()?.residenceCountry !== null) return false;

      const ability = store.ability();

      return !ADMIN_PANEL_CHECKS.some(
        ({ action, subject: subjectName }) =>
          ability?.can(action, subjectName) === true
      );
    })
  })),
  withMethods((store) => {
    const storage = inject(LocalStorageService);

    function getAccessToken(): string | null {
      return store.accessToken();
    }

    function isAccessTokenExpired(): boolean {
      const expiryTime = getTokenExpiryTime();

      return expiryTime === null || expiryTime < Date.now();
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
      // The region first: another tab that sees the user reads both.
      storage.setItem(AUTH_REGION_KEY, store.region());
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
      storage.removeItem(AUTH_REGION_KEY);
      patchState(store, {
        accessToken: null,
        user: null,
        region: HOME_DATA_REGION,
        ability: null,
        mfaMandatory: false
      });
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
      const unpacked = unpackRules(rules as PackRule<RawRuleOf<AppAbility>>[]);
      const ability = createMongoAbility<AppAbility>(unpacked);

      // The server refuses a non-super actor every write on an account that
      // holds a super role (assertNotSuperTarget), whatever the grants say.
      if (!ability.can('manage', 'all')) {
        ability.update([...unpacked, SUPER_TARGET_DENY]);
      }

      patchState(store, { ability });
    }

    function setMfaMandatory(
      mfaMandatory: UserPermissionsResponse['mfaMandatory']
    ): void {
      patchState(store, { mfaMandatory: mfaMandatory === true });
    }

    function hasPermissions(
      check: PermissionCheck | PermissionCheck[]
    ): boolean {
      const checks = Array.isArray(check) ? check : [check];
      // Read the ability before the emptiness bail so the signal stays tracked
      // by callers reacting to it, and deny an empty list instead of the
      // fail-open `[].every() === true`.
      const ability = store.ability();

      if (!ability || checks.length === 0) return false;

      return checks.every(({ action, subject: subjectName, instance }) => {
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
      setMfaMandatory,
      hasPermissions
    };
  })
);
