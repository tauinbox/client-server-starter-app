import { TestBed } from '@angular/core/testing';
import { packRules } from '@casl/ability/extra';
import { createMongoAbility } from '@casl/ability';
import { AuthStore, AUTH_USER_KEY } from './auth.store';
import type { AppAbility } from '../casl/app-ability';
import { LocalStorageService } from '@core/services/local-storage.service';
import type { AuthResponse } from '../models/auth.types';
import type { User } from '@shared/models/user.types';

// Helper: create a base64url-encoded JWT with given payload
function createJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode(header)}.${encode(payload)}.fake-signature`;
}

function createMockUser(): User {
  return {
    id: '1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    roles: ['user'],
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null
  };
}

function createMockAuthResponse(
  overrides: { expiredToken?: boolean } = {}
): AuthResponse {
  const exp = overrides.expiredToken
    ? Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
    : Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  return {
    tokens: {
      access_token: createJwt({
        sub: '1',
        email: 'test@example.com',
        exp
      }),
      expires_in: 3600
    },
    user: createMockUser()
  };
}

describe('AuthStore', () => {
  let storageMock: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };

  function createStore(savedUser: User | null = null) {
    storageMock = {
      getItem: vi.fn().mockReturnValue(savedUser),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [{ provide: LocalStorageService, useValue: storageMock }]
    });

    return TestBed.inject(AuthStore);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('initialization', () => {
    it('should initialize with null when storage is empty', () => {
      const store = createStore(null);

      expect(store.isAuthenticated()).toBe(false);
      expect(store.user()).toBeNull();
      expect(store.hasPersistedUser()).toBe(false);
    });

    it('should restore user from localStorage but NOT be authenticated (no access token in memory)', () => {
      const savedUser = createMockUser();
      const store = createStore(savedUser);

      // User info restored from storage
      expect(store.user()).toEqual(savedUser);
      expect(store.hasPersistedUser()).toBe(true);
      // But NOT authenticated — access token is never persisted
      expect(store.isAuthenticated()).toBe(false);
      expect(store.getAccessToken()).toBeNull();
    });

    it('should always start with null access token regardless of localStorage', () => {
      const savedUser = createMockUser();
      const store = createStore(savedUser);

      expect(store.getAccessToken()).toBeNull();
      expect(store.isAuthenticated()).toBe(false);
    });
  });

  describe('computed signals', () => {
    it('should report isAccessTokenExpired true when no token in memory', () => {
      const store = createStore(null);

      expect(store.isAccessTokenExpired()).toBe(true);
    });

    it('should report isAccessTokenExpired false for valid in-memory token', () => {
      const store = createStore(null);
      store.saveAuthResponse(createMockAuthResponse());

      expect(store.isAccessTokenExpired()).toBe(false);
    });

    it('should report isAccessTokenExpired true for expired in-memory token', () => {
      const store = createStore(null);
      store.saveAuthResponse(createMockAuthResponse({ expiredToken: true }));

      expect(store.isAccessTokenExpired()).toBe(true);
    });

    it('should compute isAdmin from user', () => {
      const store = createStore(null);
      const auth = createMockAuthResponse();
      auth.user.roles = ['admin'];
      store.saveAuthResponse(auth);

      expect(store.isAdmin()).toBe(true);
    });
  });

  describe('saveAuthResponse', () => {
    it('should store user to localStorage and set access token in memory only', () => {
      const store = createStore(null);
      const authResponse = createMockAuthResponse();

      store.saveAuthResponse(authResponse);

      // Only user key written to localStorage
      expect(storageMock.setItem).toHaveBeenCalledWith(
        AUTH_USER_KEY,
        authResponse.user
      );
      // Access token is in-memory
      expect(store.getAccessToken()).toBe(authResponse.tokens.access_token);
      expect(store.isAuthenticated()).toBe(true);
      expect(store.user()).toEqual(authResponse.user);
    });
  });

  describe('updateCurrentUser', () => {
    it('should update user in state and localStorage', () => {
      const store = createStore(null);
      store.saveAuthResponse(createMockAuthResponse());
      storageMock.setItem.mockClear();

      const updatedUser = { ...createMockUser(), firstName: 'Updated' };
      store.updateCurrentUser(updatedUser);

      expect(store.user()).toEqual(updatedUser);
      expect(storageMock.setItem).toHaveBeenCalledWith(
        AUTH_USER_KEY,
        updatedUser
      );
    });
  });

  describe('clearSession', () => {
    it('should clear localStorage user key and reset state', () => {
      const store = createStore(null);
      store.saveAuthResponse(createMockAuthResponse());

      store.clearSession();

      expect(storageMock.removeItem).toHaveBeenCalledWith(AUTH_USER_KEY);
      expect(store.isAuthenticated()).toBe(false);
      expect(store.user()).toBeNull();
      expect(store.getAccessToken()).toBeNull();
    });
  });

  describe('hasPersistedUser', () => {
    it('should return false when no user in storage', () => {
      const store = createStore(null);

      expect(store.hasPersistedUser()).toBe(false);
    });

    it('should return true when user exists in storage', () => {
      const store = createStore(createMockUser());

      expect(store.hasPersistedUser()).toBe(true);
    });

    it('should return false after clearSession', () => {
      const store = createStore(createMockUser());
      store.clearSession();

      expect(store.hasPersistedUser()).toBe(false);
    });
  });

  describe('getTokenExpiryTime', () => {
    it('should return expiry time in milliseconds for in-memory token', () => {
      const store = createStore(null);
      store.saveAuthResponse(createMockAuthResponse());

      const expiryTime = store.getTokenExpiryTime();
      expect(expiryTime).toBeGreaterThan(Date.now());
    });

    it('should return null when no in-memory token', () => {
      const store = createStore(null);

      expect(store.getTokenExpiryTime()).toBeNull();
    });
  });

  describe('setRules and hasPermission', () => {
    it('should return false when no rules are set', () => {
      const store = createStore(null);

      expect(store.hasPermission('list', 'User')).toBe(false);
    });

    it('should return true for a permitted action after setRules', () => {
      const store = createStore(null);
      const ability = createMongoAbility<AppAbility>([
        { action: 'list', subject: 'User' }
      ]);
      const packed = packRules(ability.rules) as unknown[][];

      store.setRules(packed);

      expect(store.hasPermission('list', 'User')).toBe(true);
    });

    it('should return false for an action not in rules', () => {
      const store = createStore(null);
      const ability = createMongoAbility<AppAbility>([
        { action: 'read', subject: 'Profile' }
      ]);
      const packed = packRules(ability.rules) as unknown[][];

      store.setRules(packed);

      expect(store.hasPermission('delete', 'User')).toBe(false);
    });

    it('should return true for all actions when manage+all rule is set (admin)', () => {
      const store = createStore(null);
      const ability = createMongoAbility<AppAbility>([
        { action: 'manage', subject: 'all' }
      ]);
      const packed = packRules(ability.rules) as unknown[][];

      store.setRules(packed);

      expect(store.hasPermission('list', 'User')).toBe(true);
      expect(store.hasPermission('delete', 'User')).toBe(true);
      expect(store.hasPermission('update', 'Profile')).toBe(true);
    });

    it('should silently skip when rules is not an array', () => {
      const store = createStore(null);

      // @ts-expect-error testing invalid input shape
      store.setRules('invalid');

      expect(store.hasPermission('list', 'User')).toBe(false);
    });

    it('should silently skip when rules contains non-array elements', () => {
      const store = createStore(null);

      // @ts-expect-error testing invalid input shape
      store.setRules([['read', 'User'], 'invalid']);

      expect(store.hasPermission('list', 'User')).toBe(false);
    });

    it('should reset ability to null on clearSession', () => {
      const store = createStore(null);
      const ability = createMongoAbility<AppAbility>([
        { action: 'list', subject: 'User' }
      ]);
      const packed = packRules(ability.rules) as unknown[][];
      store.setRules(packed);

      store.clearSession();

      expect(store.hasPermission('list', 'User')).toBe(false);
    });
  });
});
