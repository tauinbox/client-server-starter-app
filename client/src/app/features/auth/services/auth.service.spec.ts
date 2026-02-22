import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthStore, AUTH_STORAGE_KEY } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import type { AuthResponse } from '../models/auth.types';
import { LocalStorageService } from '@core/services/local-storage.service';

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
    ? Math.floor(Date.now() / 1000) - 3600
    : Math.floor(Date.now() / 1000) + 3600;

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
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    }
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    getRefreshToken: ReturnType<typeof vi.fn>;
    getTokenExpiryTime: ReturnType<typeof vi.fn>;
    saveAuthResponse: ReturnType<typeof vi.fn>;
    updateCurrentUser: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      getRefreshToken: vi.fn().mockReturnValue(null),
      getTokenExpiryTime: vi.fn().mockReturnValue(null),
      saveAuthResponse: vi.fn(),
      updateCurrentUser: vi.fn(),
      clearSession: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: authStoreMock }
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  describe('login', () => {
    it('should POST credentials and save auth response', async () => {
      const mockAuth = createMockAuthResponse();
      const credentials = { email: 'test@example.com', password: 'password' };

      const loginPromise = firstValueFrom(service.login(credentials));

      const req = httpMock.expectOne(AuthApiEnum.Login);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(credentials);
      req.flush(mockAuth);

      const result = await loginPromise;

      expect(result).toEqual(mockAuth);
      expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(mockAuth);
    });
  });

  describe('register', () => {
    it('should POST registration data', async () => {
      const registerData = {
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
        password: 'password123'
      };
      const mockUser = createMockAuthResponse().user;

      const registerPromise = firstValueFrom(service.register(registerData));

      const req = httpMock.expectOne(AuthApiEnum.Register);
      expect(req.request.method).toBe('POST');
      req.flush(mockUser);

      const result = await registerPromise;
      expect(result).toEqual(mockUser);
    });
  });

  describe('getProfile', () => {
    it('should GET profile and update current user', async () => {
      const mockUser = createMockAuthResponse().user;

      const profilePromise = firstValueFrom(service.getProfile());

      const req = httpMock.expectOne(AuthApiEnum.Profile);
      expect(req.request.method).toBe('GET');
      req.flush(mockUser);

      const result = await profilePromise;
      expect(result).toEqual(mockUser);
      expect(authStoreMock.updateCurrentUser).toHaveBeenCalledWith(mockUser);
    });
  });

  describe('refreshTokens', () => {
    it('should POST refresh token and save response', async () => {
      authStoreMock.getRefreshToken.mockReturnValue('valid-refresh-token');
      const newAuth = createMockAuthResponse();

      const tokensPromise = firstValueFrom(service.refreshTokens());

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      expect(req.request.body).toEqual({
        refresh_token: 'valid-refresh-token'
      });
      req.flush(newAuth);

      const tokens = await tokensPromise;
      expect(tokens).toEqual(newAuth.tokens);
      expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(newAuth);
    });

    it('should rethrow error when refresh fails (callers handle cleanup)', async () => {
      authStoreMock.getRefreshToken.mockReturnValue('valid-refresh-token');

      const tokensPromise = firstValueFrom(service.refreshTokens()).catch(
        (err) => err
      );

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      req.flush(
        { message: 'Invalid refresh token' },
        { status: 401, statusText: 'Unauthorized' }
      );

      const error = await tokensPromise;
      expect(error.status).toBe(401);
      expect(authStoreMock.clearSession).not.toHaveBeenCalled();
    });

    it('should return null when no refresh token available', async () => {
      authStoreMock.getRefreshToken.mockReturnValue(null);

      const tokens = await firstValueFrom(service.refreshTokens());

      expect(tokens).toBeNull();
      expect(authStoreMock.clearSession).toHaveBeenCalled();
    });

    it('should deduplicate concurrent refresh calls', async () => {
      authStoreMock.getRefreshToken.mockReturnValue('valid-refresh-token');
      const newAuth = createMockAuthResponse();

      const promise1 = firstValueFrom(service.refreshTokens());
      const promise2 = firstValueFrom(service.refreshTokens());

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      req.flush(newAuth);

      const [tokens1, tokens2] = await Promise.all([promise1, promise2]);
      expect(tokens1).toEqual(newAuth.tokens);
      expect(tokens2).toEqual(newAuth.tokens);
    });

    it('should skip HTTP and adopt tokens when another tab already refreshed', async () => {
      const originalToken = 'old-refresh-token';
      const newAuth = createMockAuthResponse(); // has 'valid-refresh-token'

      authStoreMock.getRefreshToken.mockReturnValue(originalToken);

      // Simulate another tab having written fresh tokens to localStorage
      const localStorageService = TestBed.inject(LocalStorageService);
      localStorageService.setItem(AUTH_STORAGE_KEY, newAuth);

      const tokens = await firstValueFrom(service.refreshTokens());

      // No HTTP call should have been made
      httpMock.expectNone(AuthApiEnum.RefreshToken);

      // Should have adopted the tokens from localStorage
      expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(newAuth);
      expect(tokens).toEqual(newAuth.tokens);
    });

    it('should make HTTP call when localStorage has same refresh token as in-memory', async () => {
      const sharedToken = 'valid-refresh-token';
      const currentAuth = createMockAuthResponse(); // has 'valid-refresh-token'
      const newAuth = createMockAuthResponse();

      authStoreMock.getRefreshToken.mockReturnValue(sharedToken);

      // localStorage has the same refresh token — no other tab has refreshed
      const localStorageService = TestBed.inject(LocalStorageService);
      localStorageService.setItem(AUTH_STORAGE_KEY, currentAuth);

      const tokensPromise = firstValueFrom(service.refreshTokens());

      // HTTP call should still be made
      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      req.flush(newAuth);

      const tokens = await tokensPromise;
      expect(tokens).toEqual(newAuth.tokens);
      expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(newAuth);
    });
  });

  describe('logout', () => {
    it('should POST logout when authenticated', () => {
      authStoreMock.isAuthenticated.mockReturnValue(true);

      service.logout();

      const req = httpMock.expectOne(AuthApiEnum.Logout);
      expect(req.request.method).toBe('POST');
      req.flush({});

      expect(authStoreMock.clearSession).toHaveBeenCalled();
    });

    it('should not POST when not authenticated', () => {
      authStoreMock.isAuthenticated.mockReturnValue(false);

      service.logout();

      httpMock.expectNone(AuthApiEnum.Logout);
    });
  });

  describe('initSession', () => {
    it('should not schedule refresh when not authenticated', () => {
      authStoreMock.isAuthenticated.mockReturnValue(false);
      const scheduleSpy = vi.spyOn(service, 'scheduleTokenRefresh');

      service.initSession();

      expect(scheduleSpy).not.toHaveBeenCalled();
    });

    it('should schedule refresh when authenticated', () => {
      authStoreMock.isAuthenticated.mockReturnValue(true);
      authStoreMock.getTokenExpiryTime.mockReturnValue(null);
      const scheduleSpy = vi.spyOn(service, 'scheduleTokenRefresh');

      service.initSession();

      expect(scheduleSpy).toHaveBeenCalled();
    });
  });
});
