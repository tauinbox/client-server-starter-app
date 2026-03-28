import { TestBed } from '@angular/core/testing';
import type { HttpErrorResponse } from '@angular/common/http';
import {
  HttpClient,
  HttpContext,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoTestingModuleWithLangs } from '../../../test-utils/transloco-testing';
import { errorInterceptor } from './error.interceptor';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { RBAC_RETRY_CONTEXT } from '@core/context-tokens/rbac-retry';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';

const mockRules = [[['read', 'User']]];

describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let authStoreMock: { setRules: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    snackBarMock = { open: vi.fn() };
    authStoreMock = { setRules: vi.fn() };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: AuthStore, useValue: authStoreMock }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should show snackbar for non-401 error', () => {
    http.get('/api/test').subscribe({ error: vi.fn() });

    const req = httpMock.expectOne('/api/test');
    req.flush(
      { message: 'Server Error' },
      { status: 500, statusText: 'Internal Server Error' }
    );

    expect(snackBarMock.open).toHaveBeenCalledWith('Server Error', 'Close', {
      duration: 5000
    });
  });

  it('should not show snackbar for 401 error', () => {
    http.get('/api/test').subscribe({ error: vi.fn() });

    const req = httpMock.expectOne('/api/test');
    req.flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' }
    );

    expect(snackBarMock.open).not.toHaveBeenCalled();
  });

  it('should not show snackbar when silent context is set', () => {
    const context = new HttpContext().set(
      DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN,
      true
    );

    http.get('/api/test', { context }).subscribe({ error: vi.fn() });

    const req = httpMock.expectOne('/api/test');
    req.flush(
      { message: 'Bad Request' },
      { status: 400, statusText: 'Bad Request' }
    );

    expect(snackBarMock.open).not.toHaveBeenCalled();
  });

  it('should rethrow the error', () => {
    let caughtError: HttpErrorResponse | null = null;

    http.get('/api/test').subscribe({
      error: (err) => {
        caughtError = err;
      }
    });

    const req = httpMock.expectOne('/api/test');
    req.flush(
      { message: 'Not Found' },
      { status: 404, statusText: 'Not Found' }
    );

    expect(caughtError).toBeTruthy();
    expect(caughtError!.status).toBe(404);
  });

  it('should fallback to error.message when no server message', () => {
    http.get('/api/test').subscribe({ error: vi.fn() });

    const req = httpMock.expectOne('/api/test');
    req.flush(null, { status: 500, statusText: 'Internal Server Error' });

    expect(snackBarMock.open).toHaveBeenCalled();
    const message = snackBarMock.open.mock.calls[0][0] as string;
    expect(message).toBeTruthy();
  });

  it('should fallback to status code when no message available', () => {
    http.get('/api/test').subscribe({ error: vi.fn() });

    const req = httpMock.expectOne('/api/test');
    // ProgressEvent-based error (network error) — no error body
    req.error(new ProgressEvent('error'), {
      status: 0,
      statusText: 'Unknown Error'
    });

    expect(snackBarMock.open).toHaveBeenCalled();
  });

  describe('403 permissions refresh', () => {
    it('should refresh permissions and retry on 403', () => {
      http.get('/api/test').subscribe({ next: vi.fn(), error: vi.fn() });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: mockRules });

      httpMock
        .expectOne('/api/test')
        .flush({ data: 'ok' }, { status: 200, statusText: 'OK' });

      expect(authStoreMock.setRules).toHaveBeenCalledWith(mockRules);
      expect(snackBarMock.open).not.toHaveBeenCalled();
    });

    it('should return retried response on success', () => {
      let result: unknown;
      http
        .get('/api/test')
        .subscribe({ next: (v) => (result = v), error: vi.fn() });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: mockRules });

      httpMock
        .expectOne('/api/test')
        .flush({ data: 'ok' }, { status: 200, statusText: 'OK' });

      expect(result).toEqual({ data: 'ok' });
    });

    it('should show snackbar with retry error message when retry fails', () => {
      http.get('/api/test').subscribe({ error: vi.fn() });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Original Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: mockRules });

      // Retry → 403 with a more specific message
      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Still Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      // Snackbar shows retry error (not original), so caller knows the current state
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Still Forbidden',
        'Close',
        { duration: 5000 }
      );
      expect(snackBarMock.open).toHaveBeenCalledTimes(1);
    });

    it('should rethrow retry error (not original) when retry fails', () => {
      let caughtError: HttpErrorResponse | null = null;
      http.get('/api/test').subscribe({ error: (err) => (caughtError = err) });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Original' },
          { status: 403, statusText: 'Forbidden' }
        );

      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: mockRules });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Retry error' },
          { status: 403, statusText: 'Forbidden' }
        );

      expect(caughtError!.status).toBe(403);
      // Retry error propagates, not original
      expect((caughtError!.error as { message: string }).message).toBe(
        'Retry error'
      );
    });

    it('should show snackbar with original error when permissions fetch fails', () => {
      http.get('/api/test').subscribe({ error: vi.fn() });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      httpMock
        .expectOne(AuthApiEnum.Permissions)
        .flush(
          { message: 'Server Error' },
          { status: 500, statusText: 'Internal Server Error' }
        );

      // No retry expected — permissions fetch failed
      httpMock.expectNone('/api/test');

      expect(authStoreMock.setRules).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalledWith('Forbidden', 'Close', {
        duration: 5000
      });
    });

    it('should rethrow original error when permissions fetch fails', () => {
      let caughtError: HttpErrorResponse | null = null;
      http.get('/api/test').subscribe({ error: (err) => (caughtError = err) });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      httpMock
        .expectOne(AuthApiEnum.Permissions)
        .flush({ message: 'Error' }, { status: 500, statusText: 'Error' });

      expect(caughtError!.status).toBe(403);
    });

    it('should not retry when request is already marked as retry', () => {
      const context = new HttpContext().set(RBAC_RETRY_CONTEXT, true);

      http.get('/api/test', { context }).subscribe({ error: vi.fn() });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      httpMock.expectNone(AuthApiEnum.Permissions);

      expect(snackBarMock.open).toHaveBeenCalledWith('Forbidden', 'Close', {
        duration: 5000
      });
    });

    it('should not show snackbar for silent 403 when permissions fetch fails', () => {
      const context = new HttpContext().set(
        DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN,
        true
      );

      http.get('/api/test', { context }).subscribe({ error: vi.fn() });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      httpMock
        .expectOne(AuthApiEnum.Permissions)
        .flush({ message: 'Error' }, { status: 500, statusText: 'Error' });

      expect(snackBarMock.open).not.toHaveBeenCalled();
    });

    it('should not show snackbar for silent 403 when retry fails', () => {
      const context = new HttpContext().set(
        DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN,
        true
      );

      http.get('/api/test', { context }).subscribe({ error: vi.fn() });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      httpMock.expectOne(AuthApiEnum.Permissions).flush({ rules: mockRules });

      httpMock
        .expectOne('/api/test')
        .flush(
          { message: 'Forbidden' },
          { status: 403, statusText: 'Forbidden' }
        );

      expect(snackBarMock.open).not.toHaveBeenCalled();
    });
  });
});
