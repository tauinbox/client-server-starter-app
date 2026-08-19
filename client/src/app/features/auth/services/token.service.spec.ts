import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { TokenService } from './token.service';
import { AUTH_USER_KEY, AuthStore } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import type { AuthResponse } from '../models/auth.types';
import type { RoleResponse } from '@app/shared/types';

const mockUserRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

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
      roles: [mockUserRole],
      isEmailVerified: true,
      locale: 'en',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      deletedAt: null
    }
  };
}

describe('TokenService', () => {
  let service: TokenService;
  let httpMock: HttpTestingController;
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    getAccessToken: ReturnType<typeof vi.fn>;
    getTokenExpiryTime: ReturnType<typeof vi.fn>;
    saveAuthResponse: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
    setRules: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      getAccessToken: vi.fn().mockReturnValue(null),
      getTokenExpiryTime: vi.fn().mockReturnValue(null),
      saveAuthResponse: vi.fn(),
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

    service = TestBed.inject(TokenService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
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

    it('should keep a newer refresh deduplicated when a superseded one completes', async () => {
      const supersededPromise = firstValueFrom(service.refreshTokens());
      const supersededReq = httpMock.expectOne(AuthApiEnum.RefreshToken);

      service.cancelRefresh();

      const currentPromise = firstValueFrom(service.refreshTokens());
      const currentReq = httpMock.expectOne(AuthApiEnum.RefreshToken);

      supersededReq.flush(createMockAuthResponse());
      await expect(supersededPromise).resolves.toBeNull();

      const joinedPromise = firstValueFrom(service.refreshTokens());
      httpMock.expectNone(AuthApiEnum.RefreshToken);

      const newAuth = createMockAuthResponse();
      currentReq.flush(newAuth);

      await expect(currentPromise).resolves.toEqual(newAuth.tokens);
      await expect(joinedPromise).resolves.toEqual(newAuth.tokens);
    });
  });

  describe('forceLogout', () => {
    it('should cancel refresh, clear session, and navigate to login', () => {
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const cancelSpy = vi.spyOn(service, 'cancelRefresh');

      service.forceLogout();

      expect(cancelSpy).toHaveBeenCalled();
      expect(authStoreMock.clearSession).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(['/login']);
    });

    it('should navigate to login with returnUrl when provided', () => {
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      service.forceLogout('/dashboard');

      expect(authStoreMock.clearSession).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(
        ['/login'],
        expect.objectContaining({ queryParams: { returnUrl: '/dashboard' } })
      );
    });

    it('should announce the teardown before navigating away', () => {
      const router = TestBed.inject(Router);
      vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const cleared = vi.fn();
      service.sessionCleared$.subscribe(cleared);

      service.forceLogout();

      expect(cleared).toHaveBeenCalledTimes(1);
    });
  });

  describe('teardown while a refresh is in flight', () => {
    let authStore: InstanceType<typeof AuthStore>;

    beforeEach(() => {
      // The real store, not the mock: the regression is about what survives in
      // localStorage after a logout.
      TestBed.resetTestingModule();
      localStorage.clear();

      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting()
        ]
      });

      service = TestBed.inject(TokenService);
      httpMock = TestBed.inject(HttpTestingController);
      authStore = TestBed.inject(AuthStore);
    });

    afterEach(() => {
      // Drops the refresh timer a successful response schedules.
      service.cancelRefresh();
      localStorage.clear();
    });

    it('should not restore the session when the response lands after logout', async () => {
      const tokensPromise = firstValueFrom(service.refreshTokens());
      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);

      service.cancelRefresh();
      authStore.clearSession();

      req.flush(createMockAuthResponse());

      await expect(tokensPromise).resolves.toBeNull();
      expect(authStore.isAuthenticated()).toBe(false);
      expect(authStore.user()).toBeNull();
      expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    });

    it('should still store a refresh started after the teardown', async () => {
      service.cancelRefresh();
      authStore.clearSession();

      const newAuth = createMockAuthResponse();
      const tokensPromise = firstValueFrom(service.refreshTokens());
      httpMock.expectOne(AuthApiEnum.RefreshToken).flush(newAuth);

      await expect(tokensPromise).resolves.toEqual(newAuth.tokens);
      expect(authStore.isAuthenticated()).toBe(true);
      expect(authStore.user()).toEqual(newAuth.user);
      expect(localStorage.getItem(AUTH_USER_KEY)).not.toBeNull();
    });
  });
});
