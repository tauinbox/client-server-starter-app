import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import { guestGuard } from './guest.guard';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import type { Observable } from 'rxjs';
import { firstValueFrom, of, throwError } from 'rxjs';

describe('guestGuard', () => {
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
  };

  const mockRoute = {} as ActivatedRouteSnapshot;
  const mockState = { url: '/login' } as RouterStateSnapshot;

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

  it('should allow access when not authenticated', () => {
    const result = TestBed.runInInjectionContext(() =>
      guestGuard(mockRoute, mockState)
    );

    expect(result).toBe(true);
  });

  it('should redirect to profile when authenticated with valid token', () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(false);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      guestGuard(mockRoute, mockState)
    );

    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/profile']);
  });

  it('should redirect to profile when token expired but refresh succeeds', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(
      of({ access_token: 'new', refresh_token: 'new', expires_in: 3600 })
    );
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');

    const result = TestBed.runInInjectionContext(() =>
      guestGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/profile']);
  });

  it('should allow access when token expired and refresh returns null', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(of(null));

    const result = TestBed.runInInjectionContext(() =>
      guestGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
  });

  it('should allow access when token expired and refresh throws error', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(
      throwError(() => new Error('refresh failed'))
    );

    const result = TestBed.runInInjectionContext(() =>
      guestGuard(mockRoute, mockState)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
  });
});
