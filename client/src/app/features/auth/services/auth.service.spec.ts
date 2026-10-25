import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthStore } from '../store/auth.store';
import { TokenService } from './token.service';
import { NotificationsService } from '@core/services/notifications.service';
import { NotifyService } from '@core/services/notify.service';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { EntitlementsStore } from '@features/billing/store/entitlements.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import type { AuthResponse } from '../models/auth.types';
import type { NotificationEvent, RoleResponse } from '@app/shared/types';
import { STEP_UP_OPERATION } from '@app/shared/constants';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';

const mockUserRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

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
      name: 'Test User',
      isActive: true,
      roles: [mockUserRole],
      isEmailVerified: true,
      hasPassword: true,
      mfaEnabled: false,
      locale: 'en',
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
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    getAccessToken: ReturnType<typeof vi.fn>;
    hasPersistedUser: ReturnType<typeof vi.fn>;
    getTokenExpiryTime: ReturnType<typeof vi.fn>;
    saveAuthResponse: ReturnType<typeof vi.fn>;
    updateCurrentUser: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
    setRules: ReturnType<typeof vi.fn>;
    hasPermissions: ReturnType<typeof vi.fn>;
    mustEnrolMfa: ReturnType<typeof vi.fn>;
  };
  let tokenServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
    scheduleTokenRefresh: ReturnType<typeof vi.fn>;
    cancelRefresh: ReturnType<typeof vi.fn>;
    forceLogout: ReturnType<typeof vi.fn>;
    sessionCleared$: Subject<void>;
  };
  let featureFlagsStoreMock: {
    load: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let entitlementsStoreMock: {
    loaded: WritableSignal<boolean>;
    reload: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let entitlementsUpdated$: Subject<NotificationEvent>;
  let sessionInvalidated$: Subject<NotificationEvent>;
  let permissionsUpdated$: Subject<NotificationEvent>;
  let featureFlagsUpdated$: Subject<NotificationEvent>;
  let reconnected$: Subject<void>;
  let notificationsConnect: ReturnType<typeof vi.fn>;
  let notifyMock: { error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      isAccessTokenExpired: vi.fn().mockReturnValue(false),
      getAccessToken: vi.fn().mockReturnValue(null),
      hasPersistedUser: vi.fn().mockReturnValue(false),
      getTokenExpiryTime: vi.fn().mockReturnValue(null),
      saveAuthResponse: vi.fn(),
      updateCurrentUser: vi.fn(),
      clearSession: vi.fn(),
      setRules: vi.fn(),
      hasPermissions: vi.fn().mockReturnValue(false),
      mustEnrolMfa: vi.fn().mockReturnValue(false)
    };

    tokenServiceMock = {
      refreshTokens: vi.fn().mockReturnValue(of(null)),
      scheduleTokenRefresh: vi.fn(),
      cancelRefresh: vi.fn(),
      forceLogout: vi.fn(),
      sessionCleared$: new Subject<void>()
    };

    featureFlagsStoreMock = {
      load: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn()
    };

    entitlementsStoreMock = {
      loaded: signal(false),
      reload: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn()
    };
    entitlementsUpdated$ = new Subject<NotificationEvent>();
    sessionInvalidated$ = new Subject<NotificationEvent>();
    permissionsUpdated$ = new Subject<NotificationEvent>();
    featureFlagsUpdated$ = new Subject<NotificationEvent>();
    reconnected$ = new Subject<void>();
    notificationsConnect = vi.fn();
    notifyMock = { error: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: TokenService, useValue: tokenServiceMock },
        {
          provide: NotificationsService,
          useValue: {
            connect: notificationsConnect,
            disconnect: vi.fn(),
            sessionInvalidated$,
            permissionsUpdated$,
            featureFlagsUpdated$,
            entitlementsUpdated$: entitlementsUpdated$,
            reconnected$
          }
        },
        { provide: FeatureFlagsStore, useValue: featureFlagsStoreMock },
        { provide: EntitlementsStore, useValue: entitlementsStoreMock },
        { provide: NotifyService, useValue: notifyMock }
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

  describe('two-factor sign-in', () => {
    const challenge = {
      mfaRequired: true as const,
      mfaToken: 'pending-token',
      expiresIn: 300
    };

    it('saves nothing when the password only buys a challenge', async () => {
      const loginPromise = firstValueFrom(
        service.login({ email: 'test@example.com', password: 'password' })
      );

      httpMock.expectOne(AuthApiEnum.Login).flush(challenge);

      await expect(loginPromise).resolves.toEqual(challenge);
      // A challenge is not a session: saving it would sign the caller in with
      // one factor, which is the whole thing the second factor prevents.
      expect(authStoreMock.saveAuthResponse).not.toHaveBeenCalled();
      httpMock.expectNone(AuthApiEnum.Permissions);
    });

    it('starts the session once the code is accepted', async () => {
      const mockAuth = createMockAuthResponse();
      const verifyPromise = firstValueFrom(
        service.verifyMfa('pending-token', '123456')
      );

      const req = httpMock.expectOne(AuthApiEnum.MfaVerify);
      expect(req.request.body).toEqual({
        mfaToken: 'pending-token',
        code: '123456'
      });
      req.flush(mockAuth);
      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });

      await expect(verifyPromise).resolves.toEqual(mockAuth);
      expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(mockAuth);
    });

    it('starts the session from a recovery code too', async () => {
      const mockAuth = createMockAuthResponse();
      const recoveryPromise = firstValueFrom(
        service.verifyMfaRecoveryCode('pending-token', 'AAAAAAAA-AAAAAAAA')
      );

      const req = httpMock.expectOne(AuthApiEnum.MfaRecovery);
      expect(req.request.body).toEqual({
        mfaToken: 'pending-token',
        recoveryCode: 'AAAAAAAA-AAAAAAAA'
      });
      req.flush(mockAuth);
      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });

      await expect(recoveryPromise).resolves.toEqual(mockAuth);
      expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(mockAuth);
    });
  });

  describe('two-factor enrolment', () => {
    it('sends the current password with the setup request', async () => {
      const setupPromise = firstValueFrom(service.startMfaSetup('Password1'));

      const req = httpMock.expectOne(AuthApiEnum.MfaSetup);
      expect(req.request.body).toEqual({ currentPassword: 'Password1' });
      req.flush({ secret: 'S', otpauthUri: 'otpauth://', qrDataUrl: 'data:' });

      await expect(setupPromise).resolves.toEqual({
        secret: 'S',
        otpauthUri: 'otpauth://',
        qrDataUrl: 'data:'
      });
    });

    it('returns the recovery codes the enable call answers with', async () => {
      const enablePromise = firstValueFrom(service.enableMfa('123456'));

      const req = httpMock.expectOne(AuthApiEnum.MfaEnable);
      expect(req.request.body).toEqual({ code: '123456' });
      req.flush({ recoveryCodes: ['AAAAAAAA-AAAAAAAA'] });

      await expect(enablePromise).resolves.toEqual({
        recoveryCodes: ['AAAAAAAA-AAAAAAAA']
      });
    });

    it('posts the step-up factor when the account turns it off', async () => {
      const disablePromise = firstValueFrom(
        service.disableMfa({ currentPassword: 'Password1' })
      );

      const req = httpMock.expectOne(AuthApiEnum.MfaDisable);
      expect(req.request.body).toEqual({ currentPassword: 'Password1' });
      req.flush({ message: 'off' });

      await expect(disablePromise).resolves.toEqual({ message: 'off' });
    });

    it('returns the fresh codes the regeneration answers with', async () => {
      const regeneratePromise = firstValueFrom(
        service.regenerateRecoveryCodes({ code: '123456' })
      );

      const req = httpMock.expectOne(AuthApiEnum.MfaRecoveryCodes);
      expect(req.request.body).toEqual({ code: '123456' });
      req.flush({ recoveryCodes: ['KKKKKKKK-KKKKKKKK'] });

      await expect(regeneratePromise).resolves.toEqual({
        recoveryCodes: ['KKKKKKKK-KKKKKKKK']
      });
    });
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

      // login() now awaits fetchPermissions() before emitting — flush it
      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });

      const result = await loginPromise;

      expect(result).toEqual(mockAuth);
      expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(mockAuth);
      // reload(), not load(): flags loaded during the anonymous bootstrap
      // must be re-fetched for the authenticated user.
      expect(featureFlagsStoreMock.reload).toHaveBeenCalled();
    });

    it('loads no resource catalog for an administrator', async () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      const loginPromise = firstValueFrom(
        service.login({ email: 'test@example.com', password: 'password' })
      );

      httpMock.expectOne(AuthApiEnum.Login).flush(createMockAuthResponse());
      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });
      await loginPromise;

      httpMock.expectNone((req) => req.url.startsWith('/api/v1/rbac/'));
    });
  });

  describe('fetchPermissions', () => {
    it('surfaces a failed permissions request instead of failing silently', async () => {
      const promise = service.fetchPermissions();

      httpMock
        .expectOne(AuthApiEnum.Permissions)
        .flush(
          { message: 'Service unavailable' },
          { status: 503, statusText: 'Service Unavailable' }
        );

      // The promise must still resolve: sign-in awaits it.
      await expect(promise).resolves.toBeUndefined();
      expect(notifyMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ status: 503 }),
        'errors.general.permissionsUnavailable'
      );
      // Fail closed: no rules are written, so the ability stays null and every
      // permission-guarded route keeps denying.
      expect(authStoreMock.setRules).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('should POST registration data without captchaToken when not provided', async () => {
      const registerData = {
        email: 'new@example.com',
        name: 'New User',
        password: 'password123'
      };
      const mockUser = createMockAuthResponse().user;

      const registerPromise = firstValueFrom(service.register(registerData));

      const req = httpMock.expectOne(AuthApiEnum.Register);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(registerData);
      expect(req.request.body.captchaToken).toBeUndefined();
      req.flush(mockUser);

      const result = await registerPromise;
      expect(result).toEqual(mockUser);
    });

    it('should include captchaToken in body when provided', async () => {
      const registerData = {
        email: 'new@example.com',
        name: 'New User',
        password: 'password123'
      };
      const mockUser = createMockAuthResponse().user;

      const registerPromise = firstValueFrom(
        service.register(registerData, 'turnstile-xyz')
      );

      const req = httpMock.expectOne(AuthApiEnum.Register);
      expect(req.request.body).toEqual({
        ...registerData,
        captchaToken: 'turnstile-xyz'
      });
      req.flush(mockUser);

      await registerPromise;
    });
  });

  describe('forgotPassword', () => {
    it('POSTs without captchaToken when null', async () => {
      const promise = firstValueFrom(service.forgotPassword('a@b.com'));
      const req = httpMock.expectOne(AuthApiEnum.ForgotPassword);
      expect(req.request.body).toEqual({ email: 'a@b.com' });
      req.flush({ message: 'OK' });
      await promise;
    });

    it('POSTs with captchaToken when provided', async () => {
      const promise = firstValueFrom(
        service.forgotPassword('a@b.com', 'tok-1')
      );
      const req = httpMock.expectOne(AuthApiEnum.ForgotPassword);
      expect(req.request.body).toEqual({
        email: 'a@b.com',
        captchaToken: 'tok-1'
      });
      req.flush({ message: 'OK' });
      await promise;
    });
  });

  describe('resendVerificationEmail', () => {
    it('POSTs without captchaToken when none is held', async () => {
      const promise = firstValueFrom(
        service.resendVerificationEmail('a@b.com')
      );
      const req = httpMock.expectOne(AuthApiEnum.ResendVerification);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'a@b.com' });
      req.flush({ message: 'OK' });
      await promise;
    });

    it('POSTs with captchaToken when the gate asked for one', async () => {
      const promise = firstValueFrom(
        service.resendVerificationEmail('a@b.com', 'tok-1')
      );
      const req = httpMock.expectOne(AuthApiEnum.ResendVerification);
      expect(req.request.body).toEqual({
        email: 'a@b.com',
        captchaToken: 'tok-1'
      });
      req.flush({ message: 'OK' });
      await promise;
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
      // One session's entitlement mirror must never survive into the next.
      expect(entitlementsStoreMock.clear).toHaveBeenCalled();
    });

    it('should refresh an expired access token before POSTing the logout', () => {
      authStoreMock.isAuthenticated.mockReturnValue(true);
      authStoreMock.isAccessTokenExpired.mockReturnValue(true);
      tokenServiceMock.refreshTokens.mockReturnValue(
        of(createMockAuthResponse().tokens)
      );

      service.logout();

      expect(tokenServiceMock.refreshTokens).toHaveBeenCalled();
      httpMock.expectOne(AuthApiEnum.Logout).flush({});

      expect(authStoreMock.clearSession).toHaveBeenCalled();
    });

    it('should not POST when not authenticated', () => {
      authStoreMock.isAuthenticated.mockReturnValue(false);

      service.logout();

      httpMock.expectNone(AuthApiEnum.Logout);
      // The menu is gated on isAuthenticated(), but the branch must still not
      // leave the persisted user behind.
      expect(authStoreMock.clearSession).toHaveBeenCalled();
      expect(entitlementsStoreMock.clear).toHaveBeenCalled();
    });
  });

  describe('sessionCleared$ teardown', () => {
    it('clears every cached store when TokenService tears the session down', () => {
      localStorage.setItem('rbac_metadata', '{"resources":[]}');

      tokenServiceMock.sessionCleared$.next();

      // The cache of an older release must not outlive the session.
      expect(localStorage.getItem('rbac_metadata')).toBeNull();
      expect(featureFlagsStoreMock.clear).toHaveBeenCalled();
      expect(entitlementsStoreMock.clear).toHaveBeenCalled();
      expect(authStoreMock.clearSession).toHaveBeenCalled();
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

  describe('session_invalidated push', () => {
    it('signs out and keeps the current URL as the return URL', () => {
      const router = TestBed.inject(Router);
      router.navigated = true;
      vi.spyOn(router, 'url', 'get').mockReturnValue('/admin/users?q=x');

      sessionInvalidated$.next({ type: 'session_invalidated' });

      expect(tokenServiceMock.forceLogout).toHaveBeenCalledExactlyOnceWith(
        '/admin/users?q=x'
      );
    });

    it('keeps the address bar as the return URL before the first navigation ends', () => {
      vi.spyOn(TestBed.inject(Location), 'path').mockReturnValue('/profile');

      sessionInvalidated$.next({ type: 'session_invalidated' });

      expect(tokenServiceMock.forceLogout).toHaveBeenCalledExactlyOnceWith(
        '/profile'
      );
    });
  });

  describe('entitlements_updated push', () => {
    it('re-fetches the mirror when it is already loaded', () => {
      entitlementsStoreMock.loaded.set(true);

      entitlementsUpdated$.next({ type: 'entitlements_updated' });

      expect(entitlementsStoreMock.reload).toHaveBeenCalledTimes(1);
    });

    it('stays silent for a session that never resolved entitlements', () => {
      entitlementsStoreMock.loaded.set(false);

      entitlementsUpdated$.next({ type: 'entitlements_updated' });

      expect(entitlementsStoreMock.reload).not.toHaveBeenCalled();
    });
  });

  describe('flag change push', () => {
    let randomSpy: { mockRestore: () => void };

    beforeEach(() => {
      vi.useFakeTimers();
      randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);
      authStoreMock.isAuthenticated.mockReturnValue(true);
    });

    afterEach(() => {
      randomSpy.mockRestore();
      vi.useRealTimers();
    });

    it('reloads the flags after the random wait', () => {
      featureFlagsUpdated$.next({ type: 'feature_flags_updated' });
      vi.advanceTimersByTime(4999);

      expect(featureFlagsStoreMock.reload).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);

      expect(featureFlagsStoreMock.reload).toHaveBeenCalledTimes(1);
    });

    it('reloads once for flag changes that come during the wait', () => {
      featureFlagsUpdated$.next({ type: 'feature_flags_updated' });
      vi.advanceTimersByTime(2000);
      featureFlagsUpdated$.next({ type: 'feature_flags_updated' });
      vi.advanceTimersByTime(5000);

      expect(featureFlagsStoreMock.reload).toHaveBeenCalledTimes(1);
    });

    it('reloads nothing when the session ended during the wait', () => {
      featureFlagsUpdated$.next({ type: 'feature_flags_updated' });
      authStoreMock.isAuthenticated.mockReturnValue(false);
      vi.advanceTimersByTime(5000);

      expect(featureFlagsStoreMock.reload).not.toHaveBeenCalled();
    });

    it('does not reload the flags on a permission change alone', () => {
      permissionsUpdated$.next({ type: 'permissions_updated' });
      vi.advanceTimersByTime(5000);

      expect(featureFlagsStoreMock.reload).not.toHaveBeenCalled();
    });
  });

  describe('permission change push', () => {
    let randomSpy: { mockRestore: () => void };

    beforeEach(() => {
      vi.useFakeTimers();
      randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);
      authStoreMock.isAuthenticated.mockReturnValue(true);
    });

    afterEach(() => {
      randomSpy.mockRestore();
      vi.useRealTimers();
    });

    it('reloads the permissions after the random wait', () => {
      permissionsUpdated$.next({ type: 'permissions_updated' });
      vi.advanceTimersByTime(4999);

      httpMock.expectNone(AuthApiEnum.Permissions);

      vi.advanceTimersByTime(1);

      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });
    });

    it('reloads once for permission changes that come during the wait', () => {
      permissionsUpdated$.next({ type: 'permissions_updated' });
      vi.advanceTimersByTime(2000);
      permissionsUpdated$.next({ type: 'permissions_updated' });
      vi.advanceTimersByTime(5000);

      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });
    });

    it('reloads nothing when the session ended during the wait', () => {
      permissionsUpdated$.next({ type: 'permissions_updated' });
      authStoreMock.isAuthenticated.mockReturnValue(false);
      vi.advanceTimersByTime(5000);

      httpMock.expectNone(AuthApiEnum.Permissions);
    });
  });

  describe('stream reconnect', () => {
    let randomSpy: { mockRestore: () => void };

    beforeEach(() => {
      vi.useFakeTimers();
      randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);
      authStoreMock.isAuthenticated.mockReturnValue(true);
    });

    afterEach(() => {
      randomSpy.mockRestore();
      vi.useRealTimers();
    });

    it('reloads the flags, the permissions and the loaded entitlements after the random wait', () => {
      entitlementsStoreMock.loaded.set(true);

      reconnected$.next();
      vi.advanceTimersByTime(4999);

      expect(featureFlagsStoreMock.reload).not.toHaveBeenCalled();
      httpMock.expectNone(AuthApiEnum.Permissions);

      vi.advanceTimersByTime(1);

      expect(featureFlagsStoreMock.reload).toHaveBeenCalledTimes(1);
      expect(entitlementsStoreMock.reload).toHaveBeenCalledTimes(1);
      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });
    });

    it('does not load entitlements that the session never resolved', () => {
      entitlementsStoreMock.loaded.set(false);

      reconnected$.next();
      vi.advanceTimersByTime(5000);

      expect(entitlementsStoreMock.reload).not.toHaveBeenCalled();
      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });
    });

    it('reloads once for reconnects that come during the wait', () => {
      reconnected$.next();
      vi.advanceTimersByTime(2000);
      reconnected$.next();
      vi.advanceTimersByTime(5000);

      expect(featureFlagsStoreMock.reload).toHaveBeenCalledTimes(1);
      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });
    });

    it('reloads nothing when the session ended during the wait', () => {
      reconnected$.next();
      authStoreMock.isAuthenticated.mockReturnValue(false);
      vi.advanceTimersByTime(5000);

      expect(featureFlagsStoreMock.reload).not.toHaveBeenCalled();
      httpMock.expectNone(AuthApiEnum.Permissions);
    });
  });

  describe('completeAuthentication', () => {
    it('opens the stream before it loads the flags and the permissions', async () => {
      const done = service.completeAuthentication();

      expect(notificationsConnect).toHaveBeenCalledTimes(1);
      expect(notificationsConnect.mock.invocationCallOrder[0]).toBeLessThan(
        featureFlagsStoreMock.reload.mock.invocationCallOrder[0]
      );
      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: [] });
      await done;
    });
  });

  describe('unlinkOAuthAccount', () => {
    it('percent-encodes the provider name in the path', () => {
      const unlinkPromise = firstValueFrom(
        service.unlinkOAuthAccount('goo/gle')
      );

      const req = httpMock.expectOne(`${AuthApiEnum.OAuthAccounts}/goo%2Fgle`);
      expect(req.request.method).toBe('DELETE');
      req.flush({ message: 'Unlinked' });

      return expect(unlinkPromise).resolves.toEqual({ message: 'Unlinked' });
    });
  });

  // Each caller of these requests shows the refusal itself, so a global
  // notification would show the same error a second time.
  describe('error notifications', () => {
    it.each<[string, string, () => Observable<unknown>]>([
      ['getProfile', AuthApiEnum.Profile, () => service.getProfile()],
      [
        'updateProfile',
        AuthApiEnum.Profile,
        () => service.updateProfile({ name: 'A' })
      ],
      [
        'exchangeOAuthData',
        AuthApiEnum.OAuthExchange,
        () => service.exchangeOAuthData()
      ],
      [
        'initOAuthReauth',
        AuthApiEnum.OAuthReauthInit,
        () => service.initOAuthReauth(STEP_UP_OPERATION.EMAIL_CHANGE)
      ]
    ])('%s disables the global error notification', (_name, url, call) => {
      call().subscribe({ error: () => undefined });

      const req = httpMock.expectOne(url);
      expect(
        req.request.context.get(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN)
      ).toBe(true);
      req.flush(null, { status: 400, statusText: 'Bad Request' });
    });

    // The request is same-origin, so fetch sends the cookies without the flag.
    it('does not widen the credentials mode of the OAuth data exchange', () => {
      service.exchangeOAuthData().subscribe({ error: () => undefined });

      const req = httpMock.expectOne(AuthApiEnum.OAuthExchange);
      expect(req.request.withCredentials).toBe(false);
      req.flush(null, { status: 400, statusText: 'Bad Request' });
    });

    // The profile page falls back to an empty list, so the global
    // notification is the only sign that the request failed.
    it('leaves the linked-accounts request to the global notification', () => {
      service.getOAuthAccounts().subscribe({ error: () => undefined });

      const req = httpMock.expectOne(AuthApiEnum.OAuthAccounts);
      expect(
        req.request.context.get(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN)
      ).toBe(false);
      req.flush(null, { status: 500, statusText: 'Server Error' });
    });
  });
});
