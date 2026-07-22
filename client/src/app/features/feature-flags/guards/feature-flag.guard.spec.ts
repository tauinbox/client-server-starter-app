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
    hasPersistedUser: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: { refreshTokens: ReturnType<typeof vi.fn> };
  let load: ReturnType<typeof vi.fn>;
  let isEnabled: ReturnType<typeof vi.fn>;

  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/dashboard' } as RouterStateSnapshot;

  function run(key = 'new-dashboard', redirectTo?: string) {
    return TestBed.runInInjectionContext(() =>
      redirectTo
        ? featureFlagGuard(key, redirectTo)(route, state)
        : featureFlagGuard(key)(route, state)
    );
  }

  async function resolve(
    result: ReturnType<typeof run>
  ): Promise<boolean | unknown> {
    return firstValueFrom(result as Observable<boolean>);
  }

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      isAccessTokenExpired: vi.fn().mockReturnValue(false),
      hasPersistedUser: vi.fn().mockReturnValue(true),
      clearSession: vi.fn()
    };
    authServiceMock = { refreshTokens: vi.fn().mockReturnValue(of(null)) };
    load = vi.fn().mockResolvedValue(undefined);
    isEnabled = vi.fn().mockReturnValue(() => false);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: FeatureFlagsStore, useValue: { load, isEnabled } }
      ]
    });
  });

  it('returns true when the flag is enabled', async () => {
    isEnabled.mockReturnValue(() => true);
    expect(await resolve(run())).toBe(true);
  });

  it('awaits the flags load before evaluating (post-login race)', async () => {
    // Flags are not loaded yet: isEnabled flips to true only once load()
    // resolves — pre-fix the guard evaluated immediately and bounced.
    let flags: Record<string, boolean> = {};
    load.mockImplementation(async () => {
      flags = { 'new-dashboard': true };
    });
    isEnabled.mockImplementation((key: string) => () => flags[key] === true);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    expect(await resolve(run())).toBe(true);
    expect(load).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('navigates to /forbidden when the flag is off', async () => {
    isEnabled.mockReturnValue(() => false);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');
    expect(await resolve(run())).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/forbidden']);
  });

  it('honors a custom redirectTo', async () => {
    isEnabled.mockReturnValue(() => false);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');
    await resolve(run('new-dashboard', '/coming-soon'));
    expect(router.navigate).toHaveBeenCalledWith(['/coming-soon']);
  });

  it('triggers refresh-tokens then evaluates the flag', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(
      of({ access_token: 'fresh', expires_in: 3600 })
    );
    isEnabled.mockReturnValue(() => true);
    expect(await resolve(run())).toBe(true);
  });

  it('redirects to /login when not authenticated and refresh fails', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(of(null));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');
    expect(await resolve(run())).toBe(false);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/dashboard' }
    });
  });
});
