import { of, throwError, Observable, firstValueFrom } from 'rxjs';
import type { Router } from '@angular/router';
import { ensureAuthenticated } from './ensure-authenticated';
import type { TokensResponse } from '../models/auth.types';

describe('ensureAuthenticated', () => {
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
  };
  let routerMock: { navigate: ReturnType<typeof vi.fn> };

  const mockTokens: TokensResponse = {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600
  };

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      isAccessTokenExpired: vi.fn().mockReturnValue(true),
      clearSession: vi.fn()
    };

    authServiceMock = {
      refreshTokens: vi.fn()
    };

    routerMock = { navigate: vi.fn() };
  });

  it('should call onAuthenticated directly when authenticated and token valid', () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(false);

    const result = ensureAuthenticated(
      authStoreMock as Parameters<typeof ensureAuthenticated>[0],
      authServiceMock as Parameters<typeof ensureAuthenticated>[1],
      routerMock as unknown as Router,
      '/dashboard',
      () => true
    );

    expect(result).toBe(true);
    expect(authServiceMock.refreshTokens).not.toHaveBeenCalled();
  });

  it('should refresh tokens when not authenticated', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authServiceMock.refreshTokens.mockReturnValue(of(mockTokens));

    const result = ensureAuthenticated(
      authStoreMock as Parameters<typeof ensureAuthenticated>[0],
      authServiceMock as Parameters<typeof ensureAuthenticated>[1],
      routerMock as unknown as Router,
      '/dashboard',
      () => true
    );

    expect(result).toBeInstanceOf(Observable);
    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
  });

  it('should refresh tokens when authenticated but token expired', async () => {
    authStoreMock.isAuthenticated.mockReturnValue(true);
    authStoreMock.isAccessTokenExpired.mockReturnValue(true);
    authServiceMock.refreshTokens.mockReturnValue(of(mockTokens));

    const result = ensureAuthenticated(
      authStoreMock as Parameters<typeof ensureAuthenticated>[0],
      authServiceMock as Parameters<typeof ensureAuthenticated>[1],
      routerMock as unknown as Router,
      '/dashboard',
      () => true
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
  });

  it('should navigate to login when refresh returns null', async () => {
    authServiceMock.refreshTokens.mockReturnValue(of(null));

    const result = ensureAuthenticated(
      authStoreMock as Parameters<typeof ensureAuthenticated>[0],
      authServiceMock as Parameters<typeof ensureAuthenticated>[1],
      routerMock as unknown as Router,
      '/dashboard',
      () => true
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/dashboard' }
    });
  });

  it('should navigate to login on refresh error', async () => {
    authServiceMock.refreshTokens.mockReturnValue(
      throwError(() => new Error('Network error'))
    );

    const result = ensureAuthenticated(
      authStoreMock as Parameters<typeof ensureAuthenticated>[0],
      authServiceMock as Parameters<typeof ensureAuthenticated>[1],
      routerMock as unknown as Router,
      '/settings',
      () => true
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(false);
    expect(authStoreMock.clearSession).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/settings' }
    });
  });

  it('should handle onAuthenticated returning an Observable', async () => {
    authServiceMock.refreshTokens.mockReturnValue(of(mockTokens));

    const result = ensureAuthenticated(
      authStoreMock as Parameters<typeof ensureAuthenticated>[0],
      authServiceMock as Parameters<typeof ensureAuthenticated>[1],
      routerMock as unknown as Router,
      '/dashboard',
      () => of(true)
    );

    const value = await firstValueFrom(result as Observable<boolean>);
    expect(value).toBe(true);
  });
});
