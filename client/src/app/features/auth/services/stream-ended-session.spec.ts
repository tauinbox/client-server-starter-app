import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { AuthStore, AUTH_USER_KEY } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import type { AuthResponse } from '../models/auth.types';
import { jwtInterceptor } from '../interceptors/jwt.interceptor';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { NotificationsService } from '@core/services/notifications.service';
import type { UserResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

const STREAM_URL = '/api/v1/notifications/stream';
const RECONNECT_DELAY_MS = 5_000;

const user: UserResponse = {
  id: '1',
  email: 'stream@example.com',
  name: 'Stream Tab',
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

function createAuthResponse(): AuthResponse {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  return {
    tokens: {
      access_token: `${header}.${payload}.fake-signature`,
      expires_in: 3600
    },
    user
  };
}

/**
 * The server ends the stream of a dead session. When the last frame is lost,
 * the tab still signs out: the reconnect gets 401, and so does the refresh.
 */
describe('a stream that the server ends for a dead session', () => {
  let httpMock: HttpTestingController;
  let authStore: InstanceType<typeof AuthStore>;
  let notifications: NotificationsService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([errorInterceptor, jwtInterceptor])),
        provideHttpClientTesting()
      ]
    });

    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService);
    authStore = TestBed.inject(AuthStore);
    notifications = TestBed.inject(NotificationsService);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(AUTH_USER_KEY);
    try {
      httpMock.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('signs the tab out when the reconnect and its refresh get 401', async () => {
    authStore.saveAuthResponse(createAuthResponse());
    notifications.connect();

    httpMock.expectOne(STREAM_URL).flush('');
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS);

    httpMock
      .expectOne(STREAM_URL)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    httpMock
      .expectOne(AuthApiEnum.RefreshToken)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await vi.advanceTimersByTimeAsync(0);

    expect(authStore.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS);
    httpMock.expectNone(STREAM_URL);
  });
});
