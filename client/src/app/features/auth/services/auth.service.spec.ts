import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthStore } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
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
    ? Math.floor(Date.now() / 1000) - 3600
    : Math.floor(Date.now() / 1000) + 3600;

  return {
    tokens: {
      access_token: createJwt({
        sub: '1',
        email: 'test@example.com',
        exp
      }),
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
      updatedAt: '2024-01-01T00:00:00.000Z',
      deletedAt: null
    }
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    getAccessToken: ReturnType<typeof vi.fn>;
    hasPersistedUser: ReturnType<typeof vi.fn>;
    getTokenExpiryTime: ReturnType<typeof vi.fn>;
    saveAuthResponse: ReturnType<typeof vi.fn>;
    updateCurrentUser: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
    setRules: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      getAccessToken: vi.fn().mockReturnValue(null),
      hasPersistedUser: vi.fn().mockReturnValue(false),
      getTokenExpiryTime: vi.fn().mockReturnValue(null),
      saveAuthResponse: vi.fn(),
      updateCurrentUser: vi.fn(),
      clearSession: vi.fn(),
      setRules: vi.fn()
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
    // Flush any pending permissions requests fired as side effects
    httpMock
      .match(AuthApiEnum.Permissions)
      .forEach((req) => req.flush({ rules: [] }));
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
    it('should POST empty body and save response (refresh token sent as cookie)', async () => {
      const newAuth = createMockAuthResponse();

      const tokensPromise = firstValueFrom(service.refreshTokens());

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      expect(req.request.body).toEqual({});
      req.flush(newAuth);

      const tokens = await tokensPromise;
      expect(tokens).toEqual(newAuth.tokens);
      expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(newAuth);
    });

    it('should rethrow error when refresh fails (callers handle cleanup)', async () => {
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

    it('should deduplicate concurrent refresh calls', async () => {
      const newAuth = createMockAuthResponse();

      const promise1 = firstValueFrom(service.refreshTokens());
      const promise2 = firstValueFrom(service.refreshTokens());

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      req.flush(newAuth);

      const [tokens1, tokens2] = await Promise.all([promise1, promise2]);
      expect(tokens1).toEqual(newAuth.tokens);
      expect(tokens2).toEqual(newAuth.tokens);
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

  describe('isAuthenticated', () => {
    it('should reflect the store isAuthenticated state', () => {
      authStoreMock.isAuthenticated.mockReturnValue(true);
      expect(service.isAuthenticated()).toBe(true);

      authStoreMock.isAuthenticated.mockReturnValue(false);
      expect(service.isAuthenticated()).toBe(false);
    });
  });

  describe('hasPersistedUser', () => {
    it('should delegate to authStore.hasPersistedUser', () => {
      authStoreMock.hasPersistedUser.mockReturnValue(true);
      expect(service.hasPersistedUser()).toBe(true);

      authStoreMock.hasPersistedUser.mockReturnValue(false);
      expect(service.hasPersistedUser()).toBe(false);
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
