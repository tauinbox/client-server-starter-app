import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AuthApiEnum } from '../constants/auth-api.const';
import type { AuthResponse, TokensResponse } from '../models/auth.types';
import type { User } from '@features/users/models/user.types';

const mockUser: User = {
  id: '1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  isAdmin: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
};

const mockTokens: TokensResponse = {
  access_token: 'new-access-token',
  refresh_token: 'new-refresh-token',
  expires_in: 3600
};

const mockAuthResponse: AuthResponse = {
  tokens: mockTokens,
  user: mockUser
};

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let tokenServiceMock: {
    getAccessToken: ReturnType<typeof vi.fn>;
    getRefreshToken: ReturnType<typeof vi.fn>;
    saveAuthResponse: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
    clearAuth: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    getTokenExpiryTime: ReturnType<typeof vi.fn>;
    user: ReturnType<typeof vi.fn>;
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAdmin: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(() => {
    tokenServiceMock = {
      getAccessToken: vi.fn().mockReturnValue(null),
      getRefreshToken: vi.fn().mockReturnValue(null),
      saveAuthResponse: vi.fn(),
      updateUser: vi.fn(),
      clearAuth: vi.fn(),
      isAccessTokenExpired: vi.fn().mockReturnValue(true),
      getTokenExpiryTime: vi.fn().mockReturnValue(null),
      user: vi.fn().mockReturnValue(null),
      isAuthenticated: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false)
    };

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: TokenService, useValue: tokenServiceMock }
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('register', () => {
    it('should POST to register URL', () => {
      const registerData = {
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: 'password123'
      };

      service.register(registerData).subscribe((user) => {
        expect(user).toEqual(mockUser);
      });

      const req = httpMock.expectOne(AuthApiEnum.Register);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(registerData);
      req.flush(mockUser);
    });
  });

  describe('login', () => {
    it('should POST credentials and save auth response on success', () => {
      const credentials = {
        email: 'test@example.com',
        password: 'password123'
      };

      // After login succeeds, handleAuthentication calls saveAuthResponse + scheduleTokenRefresh
      // scheduleTokenRefresh calls getTokenExpiryTime which we return null for (skips scheduling)

      service.login(credentials).subscribe((response) => {
        expect(response).toEqual(mockAuthResponse);
      });

      const req = httpMock.expectOne(AuthApiEnum.Login);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(credentials);
      req.flush(mockAuthResponse);

      expect(tokenServiceMock.saveAuthResponse).toHaveBeenCalledWith(
        mockAuthResponse
      );
    });
  });

  describe('logout', () => {
    it('should call logout API and clear auth when authenticated', () => {
      tokenServiceMock.isAuthenticated.mockReturnValue(true);
      vi.spyOn(router, 'navigate');

      service.logout();

      const req = httpMock.expectOne(AuthApiEnum.Logout);
      expect(req.request.method).toBe('POST');
      req.flush({});

      expect(tokenServiceMock.clearAuth).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('should navigate with returnUrl when provided', () => {
      tokenServiceMock.isAuthenticated.mockReturnValue(true);
      vi.spyOn(router, 'navigate');

      service.logout('/dashboard');

      const req = httpMock.expectOne(AuthApiEnum.Logout);
      req.flush({});

      expect(router.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { returnUrl: '/dashboard' }
      });
    });

    it('should skip API call when not authenticated', () => {
      tokenServiceMock.isAuthenticated.mockReturnValue(false);
      vi.spyOn(router, 'navigate');

      service.logout();

      httpMock.expectNone(AuthApiEnum.Logout);
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('clearSession', () => {
    it('should clear tokens and reset in-flight refresh', () => {
      service.clearSession();
      expect(tokenServiceMock.clearAuth).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('should GET profile and update user via TokenService', () => {
      service.getProfile().subscribe((profile) => {
        expect(profile).toEqual(mockUser);
      });

      const req = httpMock.expectOne(AuthApiEnum.Profile);
      expect(req.request.method).toBe('GET');
      req.flush(mockUser);

      expect(tokenServiceMock.updateUser).toHaveBeenCalledWith(mockUser);
    });
  });

  describe('updateCurrentUser', () => {
    it('should delegate to TokenService', () => {
      service.updateCurrentUser(mockUser);
      expect(tokenServiceMock.updateUser).toHaveBeenCalledWith(mockUser);
    });
  });

  describe('refreshTokens', () => {
    it('should return null and clear auth if no refresh token', () => {
      tokenServiceMock.getRefreshToken.mockReturnValue(null);

      service.refreshTokens().subscribe((result) => {
        expect(result).toBeNull();
      });

      httpMock.expectNone(AuthApiEnum.RefreshToken);
      expect(tokenServiceMock.clearAuth).toHaveBeenCalled();
    });

    it('should POST refresh token and return tokens on success', () => {
      tokenServiceMock.getRefreshToken.mockReturnValue('my-refresh-token');

      service.refreshTokens().subscribe((tokens) => {
        expect(tokens).toEqual(mockTokens);
      });

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refresh_token: 'my-refresh-token' });
      req.flush(mockAuthResponse);

      expect(tokenServiceMock.saveAuthResponse).toHaveBeenCalledWith(
        mockAuthResponse
      );
    });

    it('should clear auth and rethrow on error', () => {
      tokenServiceMock.getRefreshToken.mockReturnValue('my-refresh-token');
      let errorCaught = false;

      service.refreshTokens().subscribe({
        error: () => {
          errorCaught = true;
        }
      });

      const req = httpMock.expectOne(AuthApiEnum.RefreshToken);
      req.flush(
        { message: 'Token expired' },
        { status: 401, statusText: 'Unauthorized' }
      );

      expect(errorCaught).toBe(true);
      expect(tokenServiceMock.clearAuth).toHaveBeenCalled();
    });

    it('should deduplicate in-flight refresh requests', () => {
      tokenServiceMock.getRefreshToken.mockReturnValue('my-refresh-token');

      // Start two refresh calls
      service.refreshTokens().subscribe();
      service.refreshTokens().subscribe();

      // Only one HTTP request should be made
      const requests = httpMock.match(AuthApiEnum.RefreshToken);
      expect(requests.length).toBe(1);
      requests[0].flush(mockAuthResponse);
    });
  });

  describe('#scheduleTokenRefresh (constructor)', () => {
    it('should not schedule refresh when not authenticated', () => {
      // The main beforeEach already creates the service with isAuthenticated=false
      // and getTokenExpiryTime=null — no refresh request should be made
      httpMock.expectNone(AuthApiEnum.RefreshToken);
    });
  });
});

describe('AuthService (scheduleTokenRefresh on construct)', () => {
  function createServiceWithAuth(tokenExpiryTime: number | null) {
    const tokenSvc = {
      getAccessToken: vi.fn().mockReturnValue('access-token'),
      getRefreshToken: vi.fn().mockReturnValue('refresh-token'),
      saveAuthResponse: vi.fn(),
      updateUser: vi.fn(),
      clearAuth: vi.fn(),
      isAccessTokenExpired: vi.fn().mockReturnValue(false),
      getTokenExpiryTime: vi.fn().mockReturnValue(tokenExpiryTime),
      user: vi.fn().mockReturnValue(mockUser),
      isAuthenticated: vi.fn().mockReturnValue(true),
      isAdmin: vi.fn().mockReturnValue(false)
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: TokenService, useValue: tokenSvc }
      ]
    });

    const svc = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);
    return { service: svc, httpMock: http, tokenService: tokenSvc };
  }

  it('should refresh immediately when time to refresh is <= 0', () => {
    // Expiry 30s from now, but window is 60s => timeToRefresh = -30s => immediate
    const { httpMock: http, tokenService: tokenSvc } = createServiceWithAuth(
      Date.now() + 30 * 1000
    );

    const req = http.expectOne(AuthApiEnum.RefreshToken);
    req.flush(mockAuthResponse);

    expect(tokenSvc.saveAuthResponse).toHaveBeenCalledWith(mockAuthResponse);
    http.verify();
  });

  it('should not schedule when getTokenExpiryTime returns null', () => {
    const { httpMock: http } = createServiceWithAuth(null);

    http.expectNone(AuthApiEnum.RefreshToken);
    http.verify();
  });

  it('should schedule refresh via timer for future expiry', () => {
    vi.useFakeTimers();

    try {
      // Expiry 5 minutes from now => timeToRefresh = 240s
      const { httpMock: http, tokenService: tokenSvc } = createServiceWithAuth(
        Date.now() + 5 * 60 * 1000
      );

      // No immediate refresh
      http.expectNone(AuthApiEnum.RefreshToken);

      // Advance to just before the refresh (240s - 1s)
      vi.advanceTimersByTime(239 * 1000);
      http.expectNone(AuthApiEnum.RefreshToken);

      // Advance past the refresh point
      vi.advanceTimersByTime(2 * 1000);
      const req = http.expectOne(AuthApiEnum.RefreshToken);
      req.flush(mockAuthResponse);

      expect(tokenSvc.saveAuthResponse).toHaveBeenCalledWith(mockAuthResponse);
      http.verify();
    } finally {
      vi.useRealTimers();
    }
  });
});
