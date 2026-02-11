import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import { adminGuard } from './admin.guard';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import type { Observable } from 'rxjs';
import { firstValueFrom, of } from 'rxjs';

describe('adminGuard', () => {
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    isAdmin: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
  };

  const mockRoute = {} as ActivatedRouteSnapshot;
  const mockState = { url: '/admin' } as RouterStateSnapshot;

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      isAccessTokenExpired: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false),
      clearSession: vi.fn()
    };

    authServiceMock = {
      refreshTokens: vi.fn().mockReturnValue(of(null))
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: AuthService, useValue: authServiceMock }
      ]
    });
  });

  it('should return true for admin user', () => {
    authStoreMock.isAdmin.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      adminGuard(mockRoute, mockState)
    );

    expect(result).toBe(true);
  });

  it('should navigate to forbidden for non-admin user', () => {
    authStoreMock.isAdmin.mockReturnValue(false);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      adminGuard(mockRoute, mockState)
    );

    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/forbidden']);
  });

  it('should attempt refresh when not authenticated', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(of(null));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      adminGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/admin' }
    });
  });

  it('should return true for admin after successful refresh', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(
      of({ access_token: 'new', refresh_token: 'new', expires_in: 3600 })
    );
    authStoreMock.isAdmin.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      adminGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
  });
});
