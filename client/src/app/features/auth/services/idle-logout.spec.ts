import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { EMPTY, Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { IdleTimeoutService } from './idle-timeout.service';
import { TokenService } from './token.service';
import { AuthStore } from '../store/auth.store';
import { AuthApiEnum } from '../constants/auth-api.const';
import {
  SESSION_ENDED,
  SESSION_ENDED_PARAM
} from '../constants/session-ended.const';
import type { AuthResponse } from '../models/auth.types';
import { NotificationsService } from '@core/services/notifications.service';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

function createAuthResponse(): AuthResponse {
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const payload = encode({
    sub: '1',
    email: 'idle@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  return {
    tokens: {
      access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${payload}.sig`,
      expires_in: 3600
    },
    user: {
      id: '1',
      email: 'idle@example.com',
      firstName: 'Idle',
      lastName: 'User',
      isActive: true,
      roles: [],
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

describe('idle logout wiring', () => {
  let httpMock: HttpTestingController;
  let idle: {
    timedOut$: Subject<void>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    idle = { timedOut$: new Subject<void>(), start: vi.fn(), stop: vi.fn() };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: IdleTimeoutService, useValue: idle },
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
  });

  afterEach(() => {
    TestBed.inject(TokenService).cancelRefresh();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('starts the idle timer when a session completes', () => {
    const service = TestBed.inject(AuthService);

    void service.completeAuthentication();

    expect(idle.start).toHaveBeenCalledTimes(1);
  });

  it('revokes the session and lands on /login with the idle marker', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    TestBed.inject(AuthService);
    TestBed.inject(AuthStore).saveAuthResponse(createAuthResponse());

    idle.timedOut$.next();

    httpMock.expectOne(AuthApiEnum.Logout).flush({});
    await Promise.resolve();

    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: {
        returnUrl: router.url,
        [SESSION_ENDED_PARAM]: SESSION_ENDED.Idle
      }
    });
    expect(idle.stop).toHaveBeenCalled();
    expect(TestBed.inject(AuthStore).isAuthenticated()).toBe(false);
  });

  it('a plain logout carries no idle marker', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const service = TestBed.inject(AuthService);

    service.logout();

    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: {} });
  });

  it('stops the idle timer when the session is torn down elsewhere', () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(AuthService);

    TestBed.inject(TokenService).forceLogout();

    expect(idle.stop).toHaveBeenCalled();
  });
});
