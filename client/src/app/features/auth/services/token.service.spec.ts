import { TestBed } from '@angular/core/testing';
import { TokenService } from './token.service';
import { StorageService } from '@core/services/storage.service';
import type { AuthResponse } from '../models/auth.types';
import type { User } from '@features/users/models/user.types';

/**
 * Creates a real JWT token string that jwt-decode can parse.
 * JWT = base64url(header).base64url(payload).signature
 */
function createJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${encode(header)}.${encode(payload)}.fake-signature`;
}

const mockUser: User = {
  id: '1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  isAdmin: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
};

function makeAuthResponse(accessToken: string): AuthResponse {
  return {
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
      expires_in: 3600
    },
    user: mockUser
  };
}

const mockAuthResponse = makeAuthResponse(createJwt({ exp: 9999999999 }));

describe('TokenService', () => {
  let service: TokenService;
  let storageMock: Record<string, unknown>;

  beforeEach(() => {
    storageMock = {};

    TestBed.configureTestingModule({
      providers: [
        TokenService,
        {
          provide: StorageService,
          useValue: {
            getItem: vi.fn((key: string) => storageMock[key] ?? null),
            setItem: vi.fn(
              (key: string, value: unknown) => (storageMock[key] = value)
            ),
            removeItem: vi.fn((key: string) => delete storageMock[key])
          }
        }
      ]
    });

    service = TestBed.inject(TokenService);
  });

  describe('getAccessToken', () => {
    it('should return null when no auth response', () => {
      expect(service.getAccessToken()).toBeNull();
    });

    it('should return access token after saving auth response', () => {
      service.saveAuthResponse(mockAuthResponse);
      expect(service.getAccessToken()).toBe(
        mockAuthResponse.tokens.access_token
      );
    });
  });

  describe('getRefreshToken', () => {
    it('should return null when no auth response', () => {
      expect(service.getRefreshToken()).toBeNull();
    });

    it('should return refresh token after saving auth response', () => {
      service.saveAuthResponse(mockAuthResponse);
      expect(service.getRefreshToken()).toBe('refresh-token');
    });
  });

  describe('saveAuthResponse', () => {
    it('should update signal and persist to storage', () => {
      const storage = TestBed.inject(StorageService);
      service.saveAuthResponse(mockAuthResponse);

      expect(storage.setItem).toHaveBeenCalledWith(
        'auth_storage',
        mockAuthResponse
      );
      expect(service.isAuthenticated()).toBe(true);
      expect(service.user()).toEqual(mockUser);
    });
  });

  describe('updateUser', () => {
    it('should update user when auth exists', () => {
      service.saveAuthResponse(mockAuthResponse);
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      service.updateUser(updatedUser);

      expect(service.user()).toEqual(updatedUser);
    });

    it('should not update when no auth response exists', () => {
      const storage = TestBed.inject(StorageService);
      vi.mocked(storage.setItem).mockClear();

      service.updateUser(mockUser);

      expect(storage.setItem).not.toHaveBeenCalled();
      expect(service.user()).toBeNull();
    });
  });

  describe('clearAuth', () => {
    it('should clear signal and storage', () => {
      const storage = TestBed.inject(StorageService);
      service.saveAuthResponse(mockAuthResponse);

      service.clearAuth();

      expect(storage.removeItem).toHaveBeenCalledWith('auth_storage');
      expect(service.isAuthenticated()).toBe(false);
      expect(service.user()).toBeNull();
    });
  });

  describe('isAccessTokenExpired', () => {
    it('should return true when no token exists', () => {
      expect(service.isAccessTokenExpired()).toBe(true);
    });

    it('should return false when token is valid and not expired', () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const auth = makeAuthResponse(createJwt({ exp: futureExp }));
      service.saveAuthResponse(auth);

      expect(service.isAccessTokenExpired()).toBe(false);
    });

    it('should return true when token is expired', () => {
      const pastExp = Math.floor(Date.now() / 1000) - 100;
      const auth = makeAuthResponse(createJwt({ exp: pastExp }));
      service.saveAuthResponse(auth);

      expect(service.isAccessTokenExpired()).toBe(true);
    });

    it('should return true when token is invalid (not a JWT)', () => {
      const auth = makeAuthResponse('not-a-valid-jwt');
      service.saveAuthResponse(auth);

      expect(service.isAccessTokenExpired()).toBe(true);
    });

    it('should return false when exp is missing from token', () => {
      const auth = makeAuthResponse(createJwt({ sub: 'user1' }));
      service.saveAuthResponse(auth);

      expect(service.isAccessTokenExpired()).toBe(false);
    });
  });

  describe('getTokenExpiryTime', () => {
    it('should return null when no token exists', () => {
      expect(service.getTokenExpiryTime()).toBeNull();
    });

    it('should return expiry time in milliseconds for valid token', () => {
      const auth = makeAuthResponse(createJwt({ exp: 1700000000 }));
      service.saveAuthResponse(auth);

      expect(service.getTokenExpiryTime()).toBe(1700000000 * 1000);
    });

    it('should return null when exp is missing', () => {
      const auth = makeAuthResponse(createJwt({ sub: 'user1' }));
      service.saveAuthResponse(auth);

      expect(service.getTokenExpiryTime()).toBeNull();
    });

    it('should return null when token is invalid', () => {
      const auth = makeAuthResponse('not-a-jwt');
      service.saveAuthResponse(auth);

      expect(service.getTokenExpiryTime()).toBeNull();
    });
  });

  describe('computed signals', () => {
    it('user should return null when not authenticated', () => {
      expect(service.user()).toBeNull();
    });

    it('isAuthenticated should return false initially', () => {
      expect(service.isAuthenticated()).toBe(false);
    });

    it('isAdmin should return false when not authenticated', () => {
      expect(service.isAdmin()).toBe(false);
    });

    it('isAdmin should return true for admin user', () => {
      const adminAuth: AuthResponse = {
        ...mockAuthResponse,
        user: { ...mockUser, isAdmin: true }
      };
      service.saveAuthResponse(adminAuth);

      expect(service.isAdmin()).toBe(true);
    });

    it('isAdmin should return false for non-admin user', () => {
      service.saveAuthResponse(mockAuthResponse);
      expect(service.isAdmin()).toBe(false);
    });
  });
});
