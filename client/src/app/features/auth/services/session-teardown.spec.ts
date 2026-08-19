import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { EMPTY } from 'rxjs';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AUTH_USER_KEY, AuthStore } from '../store/auth.store';
import { RbacMetadataStore } from '../store/rbac-metadata.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import { NotificationsService } from '@core/services/notifications.service';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { EntitlementsStore } from '@features/billing/store/entitlements.store';
import type { EntitlementsResponse, UserResponse } from '@app/shared/types';

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
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
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
});
