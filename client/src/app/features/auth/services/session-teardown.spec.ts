import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  GuardResult,
  RouterStateSnapshot
} from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import type { Observable } from 'rxjs';
import { EMPTY, firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AUTH_USER_KEY, AuthStore } from '../store/auth.store';
import { RbacMetadataStore } from '../store/rbac-metadata.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import { guestGuard } from '../guards/guest.guard';
import { ensureAuthenticated } from '../utils/ensure-authenticated';
import type { AuthResponse } from '../models/auth.types';
import { NotificationsService } from '@core/services/notifications.service';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { EntitlementsStore } from '@features/billing/store/entitlements.store';
import type { EntitlementsResponse, UserResponse } from '@app/shared/types';
import { LoginComponent } from '../components/login/login.component';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

const RBAC_CACHE_KEY = 'rbac_metadata';
const FEATURE_FLAGS_URL = '/api/v1/feature-flags';
const ENTITLEMENTS_URL = '/api/v1/billing/entitlements';

const cachedUser: UserResponse = {
  id: '1',
  email: 'previous@example.com',
  firstName: 'Previous',
  lastName: 'User',
  isActive: true,
  roles: [],
  isEmailVerified: true,
  locale: 'en',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

const cachedMetadata = {
  resources: [
    {
      id: 'res-1',
      name: 'User',
      subject: 'User',
      description: null,
      allowedActionNames: ['read'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    }
  ],
  actions: []
};

function createExpiredAuthResponse(): AuthResponse {
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: '1',
    email: cachedUser.email,
    exp: Math.floor(Date.now() / 1000) - 60
  });

  return {
    tokens: {
      access_token: `${header}.${payload}.fake-signature`,
      expires_in: 3600
    },
    user: cachedUser
  };
}

const entitlements: EntitlementsResponse = {
  planKey: 'pro',
  capabilities: ['billing.manage'],
  limits: {}
};

/**
 * Exercises the teardown against the real stores and the real `localStorage`,
 * because the leak these specs guard is a key left behind on the device - a
 * mocked store cannot show that.
 */
describe('session teardown', () => {
  let httpMock: HttpTestingController;
  let notificationsServiceMock: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    permissionsUpdated$: typeof EMPTY;
    featureFlagsUpdated$: typeof EMPTY;
    entitlementsUpdated$: typeof EMPTY;
  };

  beforeEach(() => {
    localStorage.setItem(RBAC_CACHE_KEY, JSON.stringify(cachedMetadata));
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(cachedUser));

    notificationsServiceMock = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      permissionsUpdated$: EMPTY,
      featureFlagsUpdated$: EMPTY,
      entitlementsUpdated$: EMPTY
    };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: NotificationsService, useValue: notificationsServiceMock }
      ]
    });

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    localStorage.removeItem(RBAC_CACHE_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  async function loadCaches() {
    const featureFlagsStore = TestBed.inject(FeatureFlagsStore);
    const entitlementsStore = TestBed.inject(EntitlementsStore);

    const flagsLoaded = featureFlagsStore.load();
    httpMock.expectOne(FEATURE_FLAGS_URL).flush({ flags: { beta: true } });
    await flagsLoaded;

    const entitlementsLoaded = entitlementsStore.load();
    httpMock.expectOne(ENTITLEMENTS_URL).flush(entitlements);
    await entitlementsLoaded;

    return { featureFlagsStore, entitlementsStore };
  }

  it('forceLogout clears the cached RBAC catalog, the flags and the entitlements', async () => {
    // The app initializer constructs AuthService on every boot, which is what
    // subscribes the teardown to TokenService.
    TestBed.inject(AuthService);
    const tokenService = TestBed.inject(TokenService);
    const rbacMetadataStore = TestBed.inject(RbacMetadataStore);
    const { featureFlagsStore, entitlementsStore } = await loadCaches();

    expect(rbacMetadataStore.resources()).toHaveLength(1);
    expect(featureFlagsStore.isEnabled('beta')()).toBe(true);
    expect(entitlementsStore.planKey()).toBe('pro');

    tokenService.forceLogout();

    expect(localStorage.getItem(RBAC_CACHE_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(rbacMetadataStore.resources()).toEqual([]);
    expect(featureFlagsStore.isEnabled('beta')()).toBe(false);
    expect(entitlementsStore.planKey()).toBeNull();
    expect(notificationsServiceMock.disconnect).toHaveBeenCalled();
  });

  it('logout clears the same state on the unauthenticated path', async () => {
    const authService = TestBed.inject(AuthService);
    const authStore = TestBed.inject(AuthStore);
    const rbacMetadataStore = TestBed.inject(RbacMetadataStore);
    const { featureFlagsStore, entitlementsStore } = await loadCaches();

    // A persisted user with no access token in memory: the menu is gated on
    // isAuthenticated(), so this branch must still leave nothing behind.
    expect(authStore.isAuthenticated()).toBe(false);

    authService.logout();

    httpMock.expectNone(AuthApiEnum.Logout);
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(localStorage.getItem(RBAC_CACHE_KEY)).toBeNull();
    expect(rbacMetadataStore.resources()).toEqual([]);
    expect(featureFlagsStore.isEnabled('beta')()).toBe(false);
    expect(entitlementsStore.planKey()).toBeNull();
  });

  it('the login page the teardown lands on re-fetches the flags it cleared', async () => {
    const authService = TestBed.inject(AuthService);
    const { featureFlagsStore } = await loadCaches();

    authService.logout();
    httpMock.expectNone(AuthApiEnum.Logout);
    expect(featureFlagsStore.isEnabled('beta')()).toBe(false);

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();

    httpMock
      .expectOne(FEATURE_FLAGS_URL)
      .flush({ flags: { 'oauth-google': true }, evaluatedAt: '' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelectorAll('.oauth-button')
    ).toHaveLength(1);
  });

  it('the expired session a guarded navigation finds clears the cached RBAC catalog', async () => {
    const authService = TestBed.inject(AuthService);
    const authStore = TestBed.inject(AuthStore);
    const rbacMetadataStore = TestBed.inject(RbacMetadataStore);
    const router = TestBed.inject(Router);
    const { featureFlagsStore, entitlementsStore } = await loadCaches();

    expect(rbacMetadataStore.resources()).toHaveLength(1);

    const guarded = ensureAuthenticated(
      authStore,
      authService,
      router,
      '/users',
      () => true
    ) as Observable<GuardResult>;
    const settled = firstValueFrom(guarded);
    httpMock
      .expectOne(AuthApiEnum.RefreshToken)
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(String(await settled)).toBe('/login?returnUrl=%2Fusers');
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(localStorage.getItem(RBAC_CACHE_KEY)).toBeNull();
    expect(rbacMetadataStore.resources()).toEqual([]);
    expect(featureFlagsStore.isEnabled('beta')()).toBe(false);
    expect(entitlementsStore.planKey()).toBeNull();
    expect(notificationsServiceMock.disconnect).toHaveBeenCalled();
  });

  it('the guest guard clears the same state when the refresh fails', async () => {
    const authStore = TestBed.inject(AuthStore);
    const rbacMetadataStore = TestBed.inject(RbacMetadataStore);
    const { featureFlagsStore, entitlementsStore } = await loadCaches();

    // The guard only reaches the refresh when a session exists but its access
    // token has expired - the state a returning tab lands on /login with.
    authStore.saveAuthResponse(createExpiredAuthResponse());
    expect(rbacMetadataStore.resources()).toHaveLength(1);

    const guarded = TestBed.runInInjectionContext(() =>
      guestGuard(
        {} as ActivatedRouteSnapshot,
        {
          url: '/login'
        } as RouterStateSnapshot
      )
    ) as Observable<boolean>;
    const settled = firstValueFrom(guarded);
    httpMock
      .expectOne(AuthApiEnum.RefreshToken)
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(await settled).toBe(true);
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(localStorage.getItem(RBAC_CACHE_KEY)).toBeNull();
    expect(rbacMetadataStore.resources()).toEqual([]);
    expect(featureFlagsStore.isEnabled('beta')()).toBe(false);
    expect(entitlementsStore.planKey()).toBeNull();
    expect(notificationsServiceMock.disconnect).toHaveBeenCalled();
  });

  describe('another tab', () => {
    // The real event carries the area it came from and the value the key was
    // left at; the listener keys on both, so the specs must supply both.
    function dispatchStorageEvent(init: StorageEventInit): void {
      window.dispatchEvent(
        new StorageEvent('storage', { storageArea: localStorage, ...init })
      );
    }

    it('logging out elsewhere tears this session down and lands it on /login', async () => {
      TestBed.inject(AuthService);
      const rbacMetadataStore = TestBed.inject(RbacMetadataStore);
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const { featureFlagsStore, entitlementsStore } = await loadCaches();

      expect(rbacMetadataStore.resources()).toHaveLength(1);

      // What the other tab actually did: the key is gone before the event
      // reaches this one.
      localStorage.removeItem(AUTH_USER_KEY);
      dispatchStorageEvent({ key: AUTH_USER_KEY, newValue: null });

      expect(localStorage.getItem(RBAC_CACHE_KEY)).toBeNull();
      expect(rbacMetadataStore.resources()).toEqual([]);
      expect(featureFlagsStore.isEnabled('beta')()).toBe(false);
      expect(entitlementsStore.planKey()).toBeNull();
      expect(notificationsServiceMock.disconnect).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { returnUrl: '/' }
      });
    });

    it('logging in elsewhere leaves this session untouched', async () => {
      TestBed.inject(AuthService);
      const rbacMetadataStore = TestBed.inject(RbacMetadataStore);
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const { featureFlagsStore, entitlementsStore } = await loadCaches();

      // A login writes the key rather than removing it. Tearing down here would
      // fight the session the other tab is establishing.
      const otherUser = { ...cachedUser, id: '2', email: 'other@example.com' };
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(otherUser));
      dispatchStorageEvent({
        key: AUTH_USER_KEY,
        newValue: JSON.stringify(otherUser)
      });

      expect(rbacMetadataStore.resources()).toHaveLength(1);
      expect(featureFlagsStore.isEnabled('beta')()).toBe(true);
      expect(entitlementsStore.planKey()).toBe('pro');
      expect(notificationsServiceMock.disconnect).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('clearing an unrelated key leaves this session untouched', async () => {
      TestBed.inject(AuthService);
      const rbacMetadataStore = TestBed.inject(RbacMetadataStore);
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const { featureFlagsStore } = await loadCaches();

      dispatchStorageEvent({ key: RBAC_CACHE_KEY, newValue: null });

      expect(rbacMetadataStore.resources()).toHaveLength(1);
      expect(featureFlagsStore.isEnabled('beta')()).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('logging out elsewhere does not disturb a tab that has no session', async () => {
      // Order matters: the store reads the key when it is first injected.
      localStorage.removeItem(AUTH_USER_KEY);
      TestBed.inject(AuthService);
      const rbacMetadataStore = TestBed.inject(RbacMetadataStore);
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const { featureFlagsStore } = await loadCaches();

      dispatchStorageEvent({ key: AUTH_USER_KEY, newValue: null });

      expect(rbacMetadataStore.resources()).toHaveLength(1);
      expect(featureFlagsStore.isEnabled('beta')()).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
