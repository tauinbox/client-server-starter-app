import { TestBed } from '@angular/core/testing';
import { packRules } from '@casl/ability/extra';
import { createMongoAbility } from '@casl/ability';
import { AuthStore } from './auth.store';
import type { AppAbility } from '../casl/app-ability';
import { LocalStorageService } from '@core/services/local-storage.service';
import type { AuthResponse } from '../models/auth.types';

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
      refresh_token: 'valid-refresh-token',
      expires_in: 3600
    },
    user: {
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
      updatedAt: '2024-01-01T00:00:00.000Z'
    }
  };
}

describe('AuthStore', () => {
  let storageMock: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };

  function createStore(savedAuth: AuthResponse | null = null) {
    storageMock = {
      getItem: vi.fn().mockReturnValue(savedAuth),
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

  describe('initialization from storage', () => {
    it('should initialize with null when storage is empty', () => {
      const store = createStore(null);

      expect(store.authResponse()).toBeNull();
      expect(store.isAuthenticated()).toBe(false);
      expect(store.user()).toBeNull();
    });

    it('should restore auth state from storage immediately on creation', () => {
      const savedAuth = createMockAuthResponse();
      const store = createStore(savedAuth);

      expect(store.authResponse()).toEqual(savedAuth);
      expect(store.isAuthenticated()).toBe(true);
      expect(store.user()).toEqual(savedAuth.user);
    });

    it('should restore expired token from storage and report authenticated', () => {
      const savedAuth = createMockAuthResponse({ expiredToken: true });
      const store = createStore(savedAuth);

      expect(store.isAuthenticated()).toBe(true);
      expect(store.isAccessTokenExpired()).toBe(true);
      expect(store.getRefreshToken()).toBe('valid-refresh-token');
    });
  });

  describe('computed signals', () => {
    it('should report isAccessTokenExpired true for expired token', () => {
      const savedAuth = createMockAuthResponse({ expiredToken: true });
      const store = createStore(savedAuth);

      expect(store.isAccessTokenExpired()).toBe(true);
    });

    it('should report isAccessTokenExpired false for valid token', () => {
      const savedAuth = createMockAuthResponse();
      const store = createStore(savedAuth);

      expect(store.isAccessTokenExpired()).toBe(false);
    });

    it('should report isAccessTokenExpired true when no token', () => {
      const store = createStore(null);

      expect(store.isAccessTokenExpired()).toBe(true);
    });

    it('should compute isAdmin from user', () => {
      const savedAuth = createMockAuthResponse();
      savedAuth.user.roles = ['admin'];
      const store = createStore(savedAuth);

      expect(store.isAdmin()).toBe(true);
    });
  });

  describe('saveAuthResponse', () => {
    it('should save to storage and update state', () => {
      const store = createStore(null);
      const authResponse = createMockAuthResponse();

      store.saveAuthResponse(authResponse);

      expect(storageMock.setItem).toHaveBeenCalledWith(
        'auth_storage',
        authResponse
      );
      expect(store.authResponse()).toEqual(authResponse);
      expect(store.isAuthenticated()).toBe(true);
    });
  });

  describe('updateCurrentUser', () => {
    it('should update user in state and storage', () => {
      const savedAuth = createMockAuthResponse();
      const store = createStore(savedAuth);

      const updatedUser = { ...savedAuth.user, firstName: 'Updated' };
      store.updateCurrentUser(updatedUser);

      expect(store.user()).toEqual(updatedUser);
      expect(storageMock.setItem).toHaveBeenCalledWith('auth_storage', {
        ...savedAuth,
        user: updatedUser
      });
    });

    it('should do nothing when no auth response exists', () => {
      const store = createStore(null);
      const user = createMockAuthResponse().user;

      store.updateCurrentUser(user);

      expect(store.user()).toBeNull();
      expect(storageMock.setItem).not.toHaveBeenCalled();
    });
  });

  describe('clearSession', () => {
    it('should clear storage and reset state', () => {
      const savedAuth = createMockAuthResponse();
      const store = createStore(savedAuth);

      store.clearSession();

      expect(storageMock.removeItem).toHaveBeenCalledWith('auth_storage');
      expect(store.authResponse()).toBeNull();
      expect(store.isAuthenticated()).toBe(false);
    });
  });

  describe('getTokenExpiryTime', () => {
    it('should return expiry time in milliseconds', () => {
      const savedAuth = createMockAuthResponse();
      const store = createStore(savedAuth);

      const expiryTime = store.getTokenExpiryTime();
      expect(expiryTime).toBeGreaterThan(Date.now());
    });

    it('should return null when no token', () => {
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
      const savedAuth = createMockAuthResponse();
      const store = createStore(savedAuth);
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
