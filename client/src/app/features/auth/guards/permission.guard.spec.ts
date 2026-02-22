import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import { permissionGuard } from './permission.guard';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import type { Observable } from 'rxjs';
import { firstValueFrom, of } from 'rxjs';

describe('permissionGuard', () => {
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    hasPermission: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
  };

  const mockRoute = {} as ActivatedRouteSnapshot;
  const mockState = { url: '/users' } as RouterStateSnapshot;

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      isAccessTokenExpired: vi.fn().mockReturnValue(false),
      hasPermission: vi.fn().mockReturnValue(false),
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

  it('should return true when user has the required permission', () => {
    authStoreMock.hasPermission.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      permissionGuard('list', 'User')(mockRoute, mockState)
    );

    expect(result).toBe(true);
  });

  it('should navigate to forbidden when user lacks the required permission', () => {
    authStoreMock.hasPermission.mockReturnValue(false);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      permissionGuard('list', 'User')(mockRoute, mockState)
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
      permissionGuard('list', 'User')(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/users' }
    });
  });

  it('should return true after successful refresh when user has permission', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(
      of({ access_token: 'new', refresh_token: 'new', expires_in: 3600 })
    );
    authStoreMock.hasPermission.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      permissionGuard('list', 'User')(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
  });

  it('should clear session on refresh failure', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(
      of({ access_token: 'new', refresh_token: 'new', expires_in: 3600 })
    );
    authStoreMock.hasPermission.mockReturnValue(false);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      permissionGuard('list', 'User')(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/forbidden']);
  });
});
