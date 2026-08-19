import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { createMongoAbility } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import { EMPTY, of, throwError } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { OAuthCallbackComponent } from './oauth-callback.component';
import { AuthStore } from '../../store/auth.store';
import { AuthService } from '../../services/auth.service';
import { TokenService } from '../../services/token.service';
import { RbacMetadataService } from '../../services/rbac-metadata.service';
import { RbacMetadataStore } from '../../store/rbac-metadata.store';
import { permissionGuard } from '../../guards/permission.guard';
import { AuthApiEnum } from '../../constants/auth-api.const';
import type { AppAbility } from '../../casl/app-ability';
import { SessionStorageService } from '@core/services/session-storage.service';
import { LocalStorageService } from '@core/services/local-storage.service';
import { NotificationsService } from '@core/services/notifications.service';
import { FeatureFlagsStore } from '../../../feature-flags/store/feature-flags.store';
import { EntitlementsStore } from '../../../billing/store/entitlements.store';
import type { AuthResponse, RoleResponse } from '@app/shared/types';

const mockUserRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockAuthResponse: AuthResponse = {
  tokens: {
    access_token: 'token',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null
  }
};

describe('OAuthCallbackComponent', () => {
  let fixture: ComponentFixture<OAuthCallbackComponent>;
  let authStoreMock: {
    saveAuthResponse: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    completeAuthentication: ReturnType<typeof vi.fn>;
    exchangeOAuthData: ReturnType<typeof vi.fn>;
  };
  let sessionStorageMock: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(async () => {
    authStoreMock = {
      saveAuthResponse: vi.fn()
    };

    authServiceMock = {
      completeAuthentication: vi.fn().mockResolvedValue(undefined),
      exchangeOAuthData: vi.fn().mockReturnValue(of(mockAuthResponse))
    };

    sessionStorageMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [OAuthCallbackComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: SessionStorageService, useValue: sessionStorageMock }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    // The testing router has no routes, so a real navigation rejects with
    // NG04002 and surfaces as an unhandled rejection.
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  it('should exchange OAuth data and save auth response', async () => {
    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(authServiceMock.exchangeOAuthData).toHaveBeenCalled();
    expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(
      mockAuthResponse
    );
    expect(authServiceMock.completeAuthentication).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile', {
      replaceUrl: true
    });
  });

  it('should navigate to returnUrl from sessionStorage', async () => {
    sessionStorageMock.getItem.mockReturnValue('/dashboard');

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(sessionStorageMock.getItem).toHaveBeenCalledWith('oauth_return_url');
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith(
      'oauth_return_url'
    );
    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard', {
      replaceUrl: true
    });
  });

  it('should not navigate until the post-authentication routine settles', async () => {
    let release!: () => void;
    authServiceMock.completeAuthentication.mockReturnValue(
      new Promise<void>((resolve) => {
        release = () => resolve();
      })
    );

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(router.navigateByUrl).not.toHaveBeenCalled();

    release();
    await fixture.whenStable();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile', {
      replaceUrl: true
    });
  });

  it('should redirect to login on exchange error', () => {
    authServiceMock.exchangeOAuthData.mockReturnValue(
      throwError(() => new Error('exchange failed'))
    );

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { oauth_error: 'auth_failed' },
      replaceUrl: true
    });
  });

  it('should redirect to login when auth response is missing required fields', () => {
    const incompleteResponse = {
      tokens: {
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600
      },
      user: { id: '', email: '', firstName: 'Test', lastName: 'User' }
    };
    authServiceMock.exchangeOAuthData.mockReturnValue(of(incompleteResponse));

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { oauth_error: 'auth_failed' },
      replaceUrl: true
    });
  });

  it('should reject returnUrl with double slashes', async () => {
    sessionStorageMock.getItem.mockReturnValue('//evil.com');

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile', {
      replaceUrl: true
    });
  });
});

// The post-authentication routine driven through the real AuthStore and the
// real AuthService: only a real ability can show that a permission-guarded
// route activates, and that guard denies without issuing a request, so a
// mocked service hides the failure entirely.
describe('OAuthCallbackComponent - post-authentication routine', () => {
  let httpMock: HttpTestingController;
  let router: Router;
  let notificationsMock: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    permissionsUpdated$: typeof EMPTY;
    featureFlagsUpdated$: typeof EMPTY;
    entitlementsUpdated$: typeof EMPTY;
  };
  let featureFlagsStoreMock: {
    load: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let entitlementsStoreMock: {
    loaded: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };

  function createJwt(payload: Record<string, unknown>): string {
    const encode = (obj: Record<string, unknown>) =>
      btoa(JSON.stringify(obj))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig`;
  }

  const liveAuthResponse: AuthResponse = {
    ...mockAuthResponse,
    tokens: {
      access_token: createJwt({
        sub: '1',
        email: 'test@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
      }),
      expires_in: 3600
    }
  };

  const packedRules = packRules(
    createMongoAbility<AppAbility>([{ action: 'read', subject: 'User' }]).rules
  ) as unknown[][];

  beforeEach(async () => {
    notificationsMock = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      permissionsUpdated$: EMPTY,
      featureFlagsUpdated$: EMPTY,
      entitlementsUpdated$: EMPTY
    };
    featureFlagsStoreMock = {
      load: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn()
    };
    entitlementsStoreMock = {
      loaded: vi.fn().mockReturnValue(false),
      reload: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [OAuthCallbackComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: LocalStorageService,
          useValue: {
            getItem: vi.fn().mockReturnValue(null),
            setItem: vi.fn(),
            removeItem: vi.fn()
          }
        },
        {
          provide: SessionStorageService,
          useValue: {
            getItem: vi.fn().mockReturnValue(null),
            setItem: vi.fn(),
            removeItem: vi.fn()
          }
        },
        {
          provide: TokenService,
          useValue: {
            scheduleTokenRefresh: vi.fn(),
            refreshTokens: vi.fn().mockReturnValue(of(null)),
            cancelRefresh: vi.fn(),
            forceLogout: vi.fn(),
            sessionCleared$: EMPTY
          }
        },
        {
          provide: RbacMetadataService,
          useValue: {
            getMetadata: vi
              .fn()
              .mockReturnValue(of({ resources: [], actions: [] }))
          }
        },
        {
          provide: RbacMetadataStore,
          useValue: {
            resources: vi.fn().mockReturnValue([]),
            setMetadata: vi.fn(),
            clear: vi.fn()
          }
        },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: FeatureFlagsStore, useValue: featureFlagsStoreMock },
        { provide: EntitlementsStore, useValue: entitlementsStoreMock }
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  // The routine chains promises (permissions -> metadata + connect ->
  // navigate); a single whenStable() drains only the first layer.
  async function settle(fixture: ComponentFixture<OAuthCallbackComponent>) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  async function runCallback() {
    const fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();
    httpMock.expectOne(AuthApiEnum.OAuthExchange).flush(liveAuthResponse);
    await settle(fixture);
    return fixture;
  }

  it('loads the permission rules, so a guarded route activates', async () => {
    const fixture = await runCallback();

    httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: packedRules });
    await settle(fixture);

    const authStore = TestBed.inject(AuthStore);
    expect(authStore.hasPermissions({ action: 'read', subject: 'User' })).toBe(
      true
    );

    const guardResult = TestBed.runInInjectionContext(() =>
      permissionGuard('read', 'User')(
        {} as ActivatedRouteSnapshot,
        { url: '/admin/users' } as RouterStateSnapshot
      )
    );
    expect(guardResult).toBe(true);
  });

  it('opens the notification stream and refreshes the feature flags', async () => {
    const fixture = await runCallback();

    httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: packedRules });
    await settle(fixture);

    expect(notificationsMock.connect).toHaveBeenCalledTimes(1);
    expect(featureFlagsStoreMock.reload).toHaveBeenCalledTimes(1);
    expect(entitlementsStoreMock.clear).toHaveBeenCalledTimes(1);
  });

  it('does not navigate before the permissions response lands', async () => {
    const fixture = await runCallback();

    const permissionsRequest = httpMock.expectOne(AuthApiEnum.Permissions);
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    permissionsRequest.flush({ rules: packedRules });
    await settle(fixture);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile', {
      replaceUrl: true
    });
  });
});
