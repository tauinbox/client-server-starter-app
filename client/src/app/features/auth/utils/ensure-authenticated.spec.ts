import { of, throwError, Observable, firstValueFrom } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { GuardResult } from '@angular/router';
import { ensureAuthenticated } from './ensure-authenticated';
import type { TokensResponse } from '../models/auth.types';

describe('ensureAuthenticated', () => {
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    hasPersistedUser: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  let router: Router;
  let navigateSpy: ReturnType<typeof vi.spyOn>;

  const mockTokens: TokensResponse = {
    access_token: 'access',
    expires_in: 3600
  };

  const run = (
    returnUrl: string,
    onAuthenticated: () => GuardResult | Observable<GuardResult> = () => true
  ) =>
    ensureAuthenticated(
      authStoreMock as Parameters<typeof ensureAuthenticated>[0],
      authServiceMock as Parameters<typeof ensureAuthenticated>[1],
      router,
      returnUrl,
      onAuthenticated
    );

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      isAccessTokenExpired: vi.fn().mockReturnValue(true),
      hasPersistedUser: vi.fn().mockReturnValue(true)
    };

    authServiceMock = {
      refreshTokens: vi.fn(),
      clearSession: vi.fn()
    };

    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    router = TestBed.inject(Router);
    navigateSpy = vi.spyOn(router, 'navigate');
  });

  it('should call onAuthenticated directly when authenticated and token valid', () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(false);

    expect(run('/dashboard')).toBe(true);
    expect(authServiceMock.refreshTokens).not.toHaveBeenCalled();
  });

  it('should refresh tokens when not authenticated', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authServiceMock.refreshTokens.mockReturnValue(of(mockTokens));

    const result = run('/dashboard');

    expect(result).toBeInstanceOf(Observable);
    const value = await firstValueFrom(result as Observable<GuardResult>);
    expect(value).toBe(true);
  });

  it('should skip the refresh round-trip when no user was ever persisted', () => {
    authStoreMock.hasPersistedUser.mockReturnValue(false);

    expect(String(run('/dashboard'))).toBe('/login?returnUrl=%2Fdashboard');
    expect(authServiceMock.refreshTokens).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('should refresh tokens when authenticated but token expired', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(of(mockTokens));

    const value = await firstValueFrom(
      run('/dashboard') as Observable<GuardResult>
    );
    expect(value).toBe(true);
  });

  it('should redirect to login when refresh returns null', async () => {
    authServiceMock.refreshTokens.mockReturnValue(of(null));

    const value = await firstValueFrom(
      run('/dashboard') as Observable<GuardResult>
    );

    expect(String(value)).toBe('/login?returnUrl=%2Fdashboard');
    expect(authServiceMock.clearSession).toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('should redirect to login on refresh error', async () => {
    authServiceMock.refreshTokens.mockReturnValue(
      throwError(() => new Error('Network error'))
    );

    const value = await firstValueFrom(
      run('/settings') as Observable<GuardResult>
    );

    expect(String(value)).toBe('/login?returnUrl=%2Fsettings');
    expect(authServiceMock.clearSession).toHaveBeenCalled();
  });

  it('should handle onAuthenticated returning an Observable', async () => {
    authServiceMock.refreshTokens.mockReturnValue(of(mockTokens));

    const value = await firstValueFrom(
      run('/dashboard', () => of(true)) as Observable<GuardResult>
    );
    expect(value).toBe(true);
  });

  it('should pass a UrlTree from onAuthenticated straight through', async () => {
    authServiceMock.refreshTokens.mockReturnValue(of(mockTokens));

    const value = await firstValueFrom(
      run('/dashboard', () =>
        router.createUrlTree(['/forbidden'])
      ) as Observable<GuardResult>
    );
    expect(String(value)).toBe('/forbidden');
  });
});
