import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import type { Observable } from 'rxjs';
import { firstValueFrom, of } from 'rxjs';

describe('authGuard', () => {
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
  };

  const mockRoute = {} as ActivatedRouteSnapshot;
  const mockState = { url: '/protected' } as RouterStateSnapshot;

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      isAccessTokenExpired: vi.fn().mockReturnValue(true),
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

  it('should return true when authenticated with valid token', () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(false);

    const result = TestBed.runInInjectionContext(() =>
      authGuard(mockRoute, mockState)
    );

    expect(result).toBe(true);
  });

  it('should navigate to login when not authenticated and refresh fails', async () => {
    authServiceMock.refreshTokens.mockReturnValue(of(null));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      authGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/protected' }
    });
  });

  it('should return true after successful token refresh', async () => {
    authServiceMock.refreshTokens.mockReturnValue(
      of({ access_token: 'new', refresh_token: 'new', expires_in: 3600 })
    );

    const result = TestBed.runInInjectionContext(() =>
      authGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
  });

  it('should refresh and allow access when authenticated with expired token', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(
      of({ access_token: 'new', refresh_token: 'new', expires_in: 3600 })
    );

    const result = TestBed.runInInjectionContext(() =>
      authGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
    expect(authServiceMock.refreshTokens).toHaveBeenCalled();
  });

  it('should redirect to login when authenticated with expired token and refresh fails', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(of(null));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      authGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/protected' }
    });
  });
});
