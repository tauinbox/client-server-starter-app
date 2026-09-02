import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  GuardResult,
  RouterStateSnapshot
} from '@angular/router';
import type { Observable } from 'rxjs';
import { firstValueFrom, of } from 'rxjs';
import { adminPanelGuard } from './admin-panel.guard';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthService } from '@features/auth/services/auth.service';

describe('adminPanelGuard', () => {
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    hasPersistedUser: ReturnType<typeof vi.fn>;
    hasPermissions: ReturnType<typeof vi.fn>;
    mustEnrolMfa: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };

  const mockRoute = {} as ActivatedRouteSnapshot;
  const mockState = { url: '/admin' } as RouterStateSnapshot;

  const run = () =>
    TestBed.runInInjectionContext(() => adminPanelGuard(mockRoute, mockState));

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      isAccessTokenExpired: vi.fn().mockReturnValue(false),
      hasPersistedUser: vi.fn().mockReturnValue(true),
      hasPermissions: vi.fn().mockReturnValue(false),
      mustEnrolMfa: vi.fn().mockReturnValue(false)
    };

    authServiceMock = {
      refreshTokens: vi.fn().mockReturnValue(of(null)),
      clearSession: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: AuthService, useValue: authServiceMock }
      ]
    });
  });

  it('should return true when the user holds any admin-panel permission', () => {
    authStoreMock.hasPermissions.mockReturnValue(true);

    expect(run()).toBe(true);
  });

  it('should send an account that owes a two-factor enrolment to the profile', () => {
    authStoreMock.hasPermissions.mockReturnValue(true);
    authStoreMock.mustEnrolMfa.mockReturnValue(true);

    expect(String(run())).toBe('/profile');
  });

  it('should redirect to forbidden when no admin-panel permission is held', () => {
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    expect(String(run())).toBe('/forbidden');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('should redirect to login with a returnUrl when the refresh fails', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);

    const value = await firstValueFrom(run() as Observable<GuardResult>);

    expect(String(value)).toBe('/login?returnUrl=%2Fadmin');
    expect(authServiceMock.clearSession).toHaveBeenCalled();
  });
});
