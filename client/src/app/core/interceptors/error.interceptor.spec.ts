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
import { of, throwError } from 'rxjs';
import { errorInterceptor } from './error.interceptor';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { RBAC_RETRY_CONTEXT } from '@core/context-tokens/rbac-retry';
import { RbacMetadataService } from '@features/auth/services/rbac-metadata.service';
import { RbacMetadataStore } from '@features/auth/store/rbac-metadata.store';

const mockResources = [
  {
    id: '1',
    name: 'User',
    subject: 'User',
    displayName: 'User',
    description: null,
    isSystem: true,
    isOrphaned: false,
    isRegistered: true,
    allowedActionNames: null,
    createdAt: '2024-01-01T00:00:00.000Z'
  }
];
const mockActions = [
  {
    id: '1',
    name: 'read',
    displayName: 'Read',
    description: 'Read',
    isDefault: true,
    createdAt: '2024-01-01T00:00:00.000Z'
  }
];

describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let rbacMetadataServiceMock: { getMetadata: ReturnType<typeof vi.fn> };
  let rbacMetadataStoreMock: { setMetadata: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    snackBarMock = { open: vi.fn() };
    rbacMetadataServiceMock = { getMetadata: vi.fn() };
    rbacMetadataStoreMock = { setMetadata: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: RbacMetadataService, useValue: rbacMetadataServiceMock },
        { provide: RbacMetadataStore, useValue: rbacMetadataStoreMock }
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

  describe('403 RBAC metadata refresh', () => {
    it('should refresh RBAC metadata and retry on 403', () => {
      rbacMetadataServiceMock.getMetadata.mockReturnValue(
        of({ resources: mockResources, actions: mockActions })
      );

      http.get('/api/test').subscribe({ error: vi.fn() });

      // First attempt → 403
      const req1 = httpMock.expectOne('/api/test');
      req1.flush(
        { message: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' }
      );

      // Retry should follow
      const req2 = httpMock.expectOne('/api/test');
      req2.flush({ data: 'ok' }, { status: 200, statusText: 'OK' });

      expect(rbacMetadataServiceMock.getMetadata).toHaveBeenCalledOnce();
      expect(rbacMetadataStoreMock.setMetadata).toHaveBeenCalledWith(
        mockResources,
        mockActions
      );
      expect(snackBarMock.open).not.toHaveBeenCalled();
    });

    it('should not show snackbar when 403 retry succeeds', () => {
      rbacMetadataServiceMock.getMetadata.mockReturnValue(
        of({ resources: mockResources, actions: mockActions })
      );

      let result: unknown;
      http
        .get('/api/test')
        .subscribe({ next: (v) => (result = v), error: vi.fn() });

      const req1 = httpMock.expectOne('/api/test');
      req1.flush(
        { message: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' }
      );

      const req2 = httpMock.expectOne('/api/test');
      req2.flush({ data: 'ok' }, { status: 200, statusText: 'OK' });

      expect(snackBarMock.open).not.toHaveBeenCalled();
      expect(result).toEqual({ data: 'ok' });
    });

    it('should show snackbar when 403 retry also fails', () => {
      rbacMetadataServiceMock.getMetadata.mockReturnValue(
        of({ resources: mockResources, actions: mockActions })
      );

      http.get('/api/test').subscribe({ error: vi.fn() });

      // First attempt → 403
      const req1 = httpMock.expectOne('/api/test');
      req1.flush(
        { message: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' }
      );

      // Retry → 403 again
      const req2 = httpMock.expectOne('/api/test');
      req2.flush(
        { message: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' }
      );

      expect(snackBarMock.open).toHaveBeenCalledWith('Forbidden', 'Close', {
        duration: 5000
      });
    });

    it('should show snackbar when metadata refresh fails', () => {
      rbacMetadataServiceMock.getMetadata.mockReturnValue(
        throwError(() => new Error('Network error'))
      );

      http.get('/api/test').subscribe({ error: vi.fn() });

      const req = httpMock.expectOne('/api/test');
      req.flush(
        { message: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' }
      );

      expect(rbacMetadataStoreMock.setMetadata).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalledWith('Forbidden', 'Close', {
        duration: 5000
      });
    });

    it('should not retry when request is already marked as retry', () => {
      const context = new HttpContext().set(RBAC_RETRY_CONTEXT, true);

      http.get('/api/test', { context }).subscribe({ error: vi.fn() });

      const req = httpMock.expectOne('/api/test');
      req.flush(
        { message: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' }
      );

      expect(rbacMetadataServiceMock.getMetadata).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalledWith('Forbidden', 'Close', {
        duration: 5000
      });
    });

    it('should not show snackbar for 403 retry when silent mode is set', () => {
      rbacMetadataServiceMock.getMetadata.mockReturnValue(
        throwError(() => new Error('Network error'))
      );

      const context = new HttpContext().set(
        DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN,
        true
      );

      http.get('/api/test', { context }).subscribe({ error: vi.fn() });

      const req = httpMock.expectOne('/api/test');
      req.flush(
        { message: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' }
      );

      expect(snackBarMock.open).not.toHaveBeenCalled();
    });

    it('should rethrow original 403 error after failed metadata refresh', () => {
      const originalError = { message: 'Forbidden' };
      rbacMetadataServiceMock.getMetadata.mockReturnValue(
        throwError(() => new Error('Network error'))
      );

      let caughtError: HttpErrorResponse | null = null;
      http.get('/api/test').subscribe({
        error: (err) => {
          caughtError = err;
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush(originalError, { status: 403, statusText: 'Forbidden' });

      expect(caughtError).toBeTruthy();
      expect(caughtError!.status).toBe(403);
    });
  });
});
