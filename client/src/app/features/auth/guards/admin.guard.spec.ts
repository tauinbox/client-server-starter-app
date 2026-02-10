import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import { adminGuard } from './admin.guard';
import { AuthService } from '../services/auth.service';
import type { Observable } from 'rxjs';
import { firstValueFrom, of } from 'rxjs';

describe('adminGuard', () => {
  let authServiceMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    isAdmin: ReturnType<typeof vi.fn>;
    refreshTokens: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };

  const mockRoute = {} as ActivatedRouteSnapshot;
  const mockState = { url: '/admin' } as RouterStateSnapshot;

  beforeEach(() => {
    authServiceMock = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      isAccessTokenExpired: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false),
      refreshTokens: vi.fn().mockReturnValue(of(null)),
      clearSession: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceMock }
      ]
    });
  });

  it('should return true for admin user', () => {
    authServiceMock.isAdmin.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      adminGuard(mockRoute, mockState)
    );

    expect(result).toBe(true);
  });

  it('should navigate to forbidden for non-admin user', () => {
    authServiceMock.isAdmin.mockReturnValue(false);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      adminGuard(mockRoute, mockState)
    );

    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/forbidden']);
  });

  it('should attempt refresh when not authenticated', async () => {
    authServiceMock.isAuthenticated.mockReturnValue(false);
    authServiceMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(of(null));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      adminGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(authServiceMock.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/admin' }
    });
  });

  it('should return true for admin after successful refresh', async () => {
    authServiceMock.isAuthenticated.mockReturnValue(false);
    authServiceMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(
      of({ access_token: 'new', refresh_token: 'new', expires_in: 3600 })
    );
    authServiceMock.isAdmin.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      adminGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
  });
});
