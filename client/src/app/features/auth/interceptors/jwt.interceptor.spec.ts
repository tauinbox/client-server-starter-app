import { TestBed } from '@angular/core/testing';
import type { HttpErrorResponse } from '@angular/common/http';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { jwtInterceptor } from './jwt.interceptor';
import { TokenService } from '../services/token.service';
import { AuthService } from '../services/auth.service';
import type { TokensResponse } from '../models/auth.types';

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let tokenServiceMock: {
    getAccessToken: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(() => {
    tokenServiceMock = {
      getAccessToken: vi.fn().mockReturnValue(null)
    };

    authServiceMock = {
      refreshTokens: vi.fn(),
      logout: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: TokenService, useValue: tokenServiceMock },
        { provide: AuthService, useValue: authServiceMock }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should attach Bearer token to non-excluded requests', () => {
    tokenServiceMock.getAccessToken.mockReturnValue('my-access-token');

    http.get('/api/v1/users').subscribe();

    const req = httpMock.expectOne('/api/v1/users');
    expect(req.request.headers.get('Authorization')).toBe(
      'Bearer my-access-token'
    );
    req.flush([]);
  });

  it('should skip token for excluded URLs (login)', () => {
    tokenServiceMock.getAccessToken.mockReturnValue('my-access-token');

    http.post('api/v1/auth/login', { email: 'a', password: 'b' }).subscribe();

    const req = httpMock.expectOne('api/v1/auth/login');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('should skip token for excluded URLs (register)', () => {
    tokenServiceMock.getAccessToken.mockReturnValue('my-access-token');

    http.post('api/v1/auth/register', {}).subscribe();

    const req = httpMock.expectOne('api/v1/auth/register');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('should skip token for excluded URLs (refresh-token)', () => {
    tokenServiceMock.getAccessToken.mockReturnValue('my-access-token');

    http.post('api/v1/auth/refresh-token', {}).subscribe();

    const req = httpMock.expectOne('api/v1/auth/refresh-token');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('should not add header when no token exists', () => {
    tokenServiceMock.getAccessToken.mockReturnValue(null);

    http.get('/api/v1/users').subscribe();

    const req = httpMock.expectOne('/api/v1/users');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('should attempt refresh on 401 for non-excluded URL', () => {
    tokenServiceMock.getAccessToken.mockReturnValue('expired-token');

    const newTokens: TokensResponse = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600
    };
    authServiceMock.refreshTokens.mockReturnValue(of(newTokens));

    http.get('/api/v1/users').subscribe();

    // First request fails with 401
    const req = httpMock.expectOne('/api/v1/users');
    req.flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' }
    );

    // Retry with new token
    const retryReq = httpMock.expectOne('/api/v1/users');
    expect(retryReq.request.headers.get('Authorization')).toBe(
      'Bearer new-access-token'
    );
    retryReq.flush([]);
  });

  it('should pass 401 through for excluded URLs (login)', () => {
    tokenServiceMock.getAccessToken.mockReturnValue(null);
    let caughtError: HttpErrorResponse | null = null;

    http.post('api/v1/auth/login', {}).subscribe({
      error: (err) => (caughtError = err)
    });

    const req = httpMock.expectOne('api/v1/auth/login');
    req.flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' }
    );

    expect(caughtError!.status).toBe(401);
    expect(authServiceMock.refreshTokens).not.toHaveBeenCalled();
  });

  it('should logout and rethrow when refresh fails', () => {
    tokenServiceMock.getAccessToken.mockReturnValue('expired-token');
    authServiceMock.refreshTokens.mockReturnValue(
      throwError(() => new Error('Refresh failed'))
    );
    vi.spyOn(router, 'url', 'get').mockReturnValue('/dashboard');

    let caughtError = false;

    http.get('/api/v1/users').subscribe({
      error: () => (caughtError = true)
    });

    const req = httpMock.expectOne('/api/v1/users');
    req.flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(caughtError).toBe(true);
    expect(authServiceMock.logout).toHaveBeenCalledWith('/dashboard');
  });

  it('should logout when refresh returns null', () => {
    tokenServiceMock.getAccessToken.mockReturnValue('expired-token');
    authServiceMock.refreshTokens.mockReturnValue(of(null));
    vi.spyOn(router, 'url', 'get').mockReturnValue('/settings');

    let caughtError = false;

    http.get('/api/v1/users').subscribe({
      error: () => (caughtError = true)
    });

    const req = httpMock.expectOne('/api/v1/users');
    req.flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(caughtError).toBe(true);
    expect(authServiceMock.logout).toHaveBeenCalledWith('/settings');
  });

  it('should pass non-401 errors through without refresh', () => {
    tokenServiceMock.getAccessToken.mockReturnValue('valid-token');
    let caughtError: HttpErrorResponse | null = null;

    http.get('/api/v1/users').subscribe({
      error: (err) => (caughtError = err)
    });

    const req = httpMock.expectOne('/api/v1/users');
    req.flush(
      { message: 'Forbidden' },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(caughtError!.status).toBe(403);
    expect(authServiceMock.refreshTokens).not.toHaveBeenCalled();
  });
});
