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
import { TranslocoTestingModuleWithLangs } from '../../../test-utils/transloco-testing';
import { errorInterceptor } from './error.interceptor';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { RBAC_RETRY_CONTEXT } from '@core/context-tokens/rbac-retry';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';

const mockRules = [[['read', 'User']]];

describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  let authStoreMock: { setRules: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    notifyMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    };
    authStoreMock = { setRules: vi.fn() };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: NotifyService, useValue: notifyMock },
        { provide: AuthStore, useValue: authStoreMock }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should notify for non-401 error', () => {
    http.get('/api/test').subscribe({ error: vi.fn() });

    const req = httpMock.expectOne('/api/test');
    req.flush(
      { message: 'Server Error' },
      { status: 500, statusText: 'Internal Server Error' }
    );

    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    const arg = notifyMock.error.mock.calls[0][0] as HttpErrorResponse;
    expect(arg.status).toBe(500);
  });

  it('should not notify for 401 error', () => {
    http.get('/api/test').subscribe({ error: vi.fn() });

    const req = httpMock.expectOne('/api/test');
    req.flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' }
    );

    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('should not notify when silent context is set', () => {
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

    expect(notifyMock.error).not.toHaveBeenCalled();
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

  it('should notify when no server message in response body', () => {
    http.get('/api/test').subscribe({ error: vi.fn() });

    const req = httpMock.expectOne('/api/test');
    req.flush(null, { status: 500, statusText: 'Internal Server Error' });

    expect(notifyMock.error).toHaveBeenCalledTimes(1);
  });

  it('should notify on network errors (no error body)', () => {
    http.get('/api/test').subscribe({ error: vi.fn() });

    const req = httpMock.expectOne('/api/test');
    // ProgressEvent-based error (network error) — no error body
    req.error(new ProgressEvent('error'), {
      status: 0,
      statusText: 'Unknown Error'
    });

    expect(notifyMock.error).toHaveBeenCalledTimes(1);
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
      expect(notifyMock.error).not.toHaveBeenCalled();
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

    it('should notify with retry error (not original) when retry fails', () => {
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

      // Notify is called with the retry error (not original), so caller knows the current state
      expect(notifyMock.error).toHaveBeenCalledTimes(1);
      const arg = notifyMock.error.mock.calls[0][0] as HttpErrorResponse;
      expect((arg.error as { message: string }).message).toBe(
        'Still Forbidden'
      );
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

    it('should notify with original error when permissions fetch fails', () => {
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
      expect(notifyMock.error).toHaveBeenCalledTimes(1);
      const arg = notifyMock.error.mock.calls[0][0] as HttpErrorResponse;
      expect((arg.error as { message: string }).message).toBe('Forbidden');
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

      expect(notifyMock.error).toHaveBeenCalledTimes(1);
      const arg = notifyMock.error.mock.calls[0][0] as HttpErrorResponse;
      expect((arg.error as { message: string }).message).toBe('Forbidden');
    });

    it('should not notify for silent 403 when permissions fetch fails', () => {
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

      expect(notifyMock.error).not.toHaveBeenCalled();
    });

    it('should not notify for silent 403 when retry fails', () => {
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

      expect(notifyMock.error).not.toHaveBeenCalled();
    });
  });
});
