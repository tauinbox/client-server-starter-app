import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from './auth.store';
import { StorageService } from '@core/services/storage.service';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';
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
        isAdmin: false,
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
      isAdmin: false,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01')
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
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: StorageService, useValue: storageMock }
      ]
    });

    return TestBed.inject(AuthStore);
  }

  afterEach(() => {
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

  describe('session restoration with expired access token', () => {
    it('should successfully refresh tokens when access token is expired', async () => {
      const savedAuth = createMockAuthResponse({ expiredToken: true });
      const store = createStore(savedAuth);
      const httpMock = TestBed.inject(HttpTestingController);

      const newAuth = createMockAuthResponse();

      const tokensPromise = firstValueFrom(store.refreshTokens());

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      expect(req.request.body).toEqual({
        refresh_token: 'valid-refresh-token'
      });
      req.flush(newAuth);

      const tokens = await tokensPromise;

      expect(tokens).toEqual(newAuth.tokens);
      expect(store.isAuthenticated()).toBe(true);
      expect(store.isAccessTokenExpired()).toBe(false);

      httpMock.verify();
    });

    it('should clear session when refresh fails', async () => {
      const savedAuth = createMockAuthResponse({ expiredToken: true });
      const store = createStore(savedAuth);
      const httpMock = TestBed.inject(HttpTestingController);

      const tokensPromise = firstValueFrom(store.refreshTokens()).catch(
        (err) => err
      );

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      req.flush(
        { message: 'Invalid refresh token' },
        { status: 401, statusText: 'Unauthorized' }
      );

      await tokensPromise;

      expect(store.isAuthenticated()).toBe(false);
      expect(store.authResponse()).toBeNull();
      expect(storageMock.removeItem).toHaveBeenCalledWith('auth_storage');

      httpMock.verify();
    });
  });

  describe('refreshTokens storage fallback', () => {
    it('should fallback to storage when store state is cleared but storage has auth', async () => {
      // Start with empty store
      const store = createStore(null);
      const httpMock = TestBed.inject(HttpTestingController);

      // Simulate: store state is empty but storage has valid auth
      // (e.g., state was cleared by a race condition but storage wasn't)
      const savedAuth = createMockAuthResponse({ expiredToken: true });
      storageMock.getItem.mockReturnValue(savedAuth);

      const newAuth = createMockAuthResponse();
      const tokensPromise = firstValueFrom(store.refreshTokens());

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      expect(req.request.body).toEqual({
        refresh_token: 'valid-refresh-token'
      });
      req.flush(newAuth);

      const tokens = await tokensPromise;
      expect(tokens).toEqual(newAuth.tokens);

      httpMock.verify();
    });

    it('should return null when neither store nor storage has refresh token', async () => {
      const store = createStore(null);
      storageMock.getItem.mockReturnValue(null);

      const tokens = await firstValueFrom(store.refreshTokens());

      expect(tokens).toBeNull();
      expect(store.isAuthenticated()).toBe(false);
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
      savedAuth.user.isAdmin = true;
      const store = createStore(savedAuth);

      expect(store.isAdmin()).toBe(true);
    });
  });
});
