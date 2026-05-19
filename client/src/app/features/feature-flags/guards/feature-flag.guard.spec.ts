import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import type { Observable } from 'rxjs';
import { firstValueFrom, of } from 'rxjs';
import { featureFlagGuard } from './feature-flag.guard';
import { AuthStore } from '../../auth/store/auth.store';
import { AuthService } from '../../auth/services/auth.service';
import { FeatureFlagsStore } from '../store/feature-flags.store';

describe('featureFlagGuard', () => {
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: { refreshTokens: ReturnType<typeof vi.fn> };
  let isEnabled: ReturnType<typeof vi.fn>;

  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/dashboard' } as RouterStateSnapshot;

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      isAccessTokenExpired: vi.fn().mockReturnValue(false),
      clearSession: vi.fn()
    };
    authServiceMock = { refreshTokens: vi.fn().mockReturnValue(of(null)) };
    isEnabled = vi.fn().mockReturnValue(() => false);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: FeatureFlagsStore, useValue: { isEnabled } }
      ]
    });
  });

  it('returns true when the flag is enabled', () => {
    isEnabled.mockReturnValue(() => true);
    const result = TestBed.runInInjectionContext(() =>
      featureFlagGuard('new-dashboard')(route, state)
    );
    expect(result).toBe(true);
  });

  it('navigates to /forbidden when the flag is off', () => {
    isEnabled.mockReturnValue(() => false);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');
    const result = TestBed.runInInjectionContext(() =>
      featureFlagGuard('new-dashboard')(route, state)
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/forbidden']);
  });

  it('honors a custom redirectTo', () => {
    isEnabled.mockReturnValue(() => false);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');
    TestBed.runInInjectionContext(() =>
      featureFlagGuard('new-dashboard', '/coming-soon')(route, state)
    );
    expect(router.navigate).toHaveBeenCalledWith(['/coming-soon']);
  });

  it('triggers refresh-tokens then evaluates the flag', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(
      of({ access_token: 'fresh', expires_in: 3600 })
    );
    isEnabled.mockReturnValue(() => true);
    const result = TestBed.runInInjectionContext(() =>
      featureFlagGuard('new-dashboard')(route, state)
    );
    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
  });

  it('redirects to /login when not authenticated and refresh fails', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(of(null));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');
    const result = TestBed.runInInjectionContext(() =>
      featureFlagGuard('new-dashboard')(route, state)
    );
    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/dashboard' }
    });
  });
});
