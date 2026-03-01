import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { firstValueFrom, of } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthStore } from '../store/auth.store';
import { TokenService } from './token.service';
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

function createMockAuthResponse(): AuthResponse {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    tokens: {
      access_token: createJwt({ sub: '1', email: 'test@example.com', exp }),
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
  let tokenServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
    scheduleTokenRefresh: ReturnType<typeof vi.fn>;
    cancelRefresh: ReturnType<typeof vi.fn>;
    forceLogout: ReturnType<typeof vi.fn>;
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

    tokenServiceMock = {
      refreshTokens: vi.fn().mockReturnValue(of(null)),
      scheduleTokenRefresh: vi.fn(),
      cancelRefresh: vi.fn(),
      forceLogout: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: TokenService, useValue: tokenServiceMock }
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
    it('should delegate to TokenService.refreshTokens', () => {
      const mockTokens = createMockAuthResponse().tokens;
      tokenServiceMock.refreshTokens.mockReturnValue(of(mockTokens));

      service.refreshTokens().subscribe((tokens) => {
        expect(tokens).toEqual(mockTokens);
      });

      expect(tokenServiceMock.refreshTokens).toHaveBeenCalled();
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
      const scheduleSpy = vi.spyOn(service, 'scheduleTokenRefresh');

      service.initSession();

      expect(scheduleSpy).toHaveBeenCalled();
    });
  });
});
