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
import { errorInterceptor } from './error.interceptor';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '../context-tokens/error-notifications';

describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    snackBarMock = { open: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBarMock }
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
});
