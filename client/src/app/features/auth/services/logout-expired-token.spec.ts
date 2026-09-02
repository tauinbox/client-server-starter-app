import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { config as rxjsConfig, EMPTY } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthStore, AUTH_USER_KEY } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import type { AuthResponse } from '../models/auth.types';
import { jwtInterceptor } from '../interceptors/jwt.interceptor';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { NotificationsService } from '@core/services/notifications.service';
import type { UserResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

const user: UserResponse = {
  id: '1',
  email: 'returning@example.com',
  firstName: 'Returning',
  lastName: 'Tab',
  isActive: true,
  roles: [],
  isEmailVerified: true,
  hasPassword: true,
  mfaEnabled: false,
  locale: 'en',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

function encode(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createAuthResponse(expiresInSeconds: number): AuthResponse {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  });

  return {
    tokens: {
      access_token: `${header}.${payload}.fake-signature`,
      expires_in: expiresInSeconds
    },
    user
  };
}

/**
 * With a bare `provideHttpClient()` the logout request carries no Authorization
 * header at all and cannot show whether the server would have accepted it, so
 * these specs wire the real interceptor chain.
 */
describe('logout with an expired access token', () => {
  let httpMock: HttpTestingController;
  let authService: AuthService;
  let authStore: InstanceType<typeof AuthStore>;
  let unhandledErrors: unknown[];
  let originalOnUnhandledError: typeof rxjsConfig.onUnhandledError;

  beforeEach(() => {
    unhandledErrors = [];
    originalOnUnhandledError = rxjsConfig.onUnhandledError;
    rxjsConfig.onUnhandledError = (error) => unhandledErrors.push(error);

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([errorInterceptor, jwtInterceptor])),
        provideHttpClientTesting(),
        {
          provide: NotificationsService,
          useValue: {
            connect: vi.fn(),
            disconnect: vi.fn(),
            permissionsUpdated$: EMPTY,
            featureFlagsUpdated$: EMPTY,
            entitlementsUpdated$: EMPTY
          }
        }
      ]
    });

    httpMock = TestBed.inject(HttpTestingController);
    authService = TestBed.inject(AuthService);
    authStore = TestBed.inject(AuthStore);
  });

  afterEach(() => {
    rxjsConfig.onUnhandledError = originalOnUnhandledError;
    localStorage.removeItem(AUTH_USER_KEY);
    try {
      httpMock.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  // The refresh resolves through a promise, so the logout it gates is issued a
  // turn after the flush that unblocks it.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('refreshes first so the server actually revokes the session', async () => {
    authStore.saveAuthResponse(createAuthResponse(-60));
    expect(authStore.isAccessTokenExpired()).toBe(true);

    authService.logout();

    const refresh = httpMock.expectOne(AuthApiEnum.RefreshToken);
    const revived = createAuthResponse(3600);
    refresh.flush(revived);
    await settle();

    const logout = httpMock.expectOne(AuthApiEnum.Logout);
    expect(logout.request.headers.get('Authorization')).toBe(
      `Bearer ${revived.tokens.access_token}`
    );
    logout.flush({});

    expect(authStore.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(unhandledErrors).toEqual([]);
  });

  it('posts the logout straight away while the access token is still usable', () => {
    const session = createAuthResponse(3600);
    authStore.saveAuthResponse(session);

    authService.logout();

    httpMock.expectNone(AuthApiEnum.RefreshToken);
    const logout = httpMock.expectOne(AuthApiEnum.Logout);
    expect(logout.request.headers.get('Authorization')).toBe(
      `Bearer ${session.tokens.access_token}`
    );
    logout.flush({});

    expect(authStore.isAuthenticated()).toBe(false);
  });

  it('tears the session down locally when the refresh the logout needs fails', async () => {
    authStore.saveAuthResponse(createAuthResponse(-60));

    authService.logout();

    httpMock
      .expectOne(AuthApiEnum.RefreshToken)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();

    // The server already rejected that refresh token; nothing left to call.
    httpMock.expectNone(AuthApiEnum.Logout);
    expect(authStore.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(unhandledErrors).toEqual([]);
  });

  it('does not let a failing logout escape as an unhandled error', async () => {
    authStore.saveAuthResponse(createAuthResponse(3600));

    authService.logout();

    httpMock
      .expectOne(AuthApiEnum.Logout)
      .flush(null, { status: 500, statusText: 'Internal Server Error' });
    // RxJS reports an unhandled error from a timeout: the hook must still be
    // installed when that turn runs.
    await settle();

    expect(authStore.isAuthenticated()).toBe(false);
    expect(unhandledErrors).toEqual([]);
  });
});
