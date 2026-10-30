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
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../test-utils/transloco-testing';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { errorInterceptor } from './error.interceptor';

const URL = '/api/test';
const CALLER_KEY = 'auth.profile.errorLinkFailed';
const CALLER_TEXT = 'Failed to link OAuth account. Please try again.';

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

describe('errorInterceptor with the real NotifyService', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let notify: NotifyService;
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    snackBarMock = { open: vi.fn() };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: AuthStore, useValue: { isAuthenticated: () => true } }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    notify = TestBed.inject(NotifyService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function refuse(): void {
    httpMock
      .expectOne(URL)
      .flush(
        { message: 'Conflict from the server' },
        { status: 409, statusText: 'Conflict' }
      );
  }

  function shownTexts(): string[] {
    return snackBarMock.open.mock.calls.map((call) => call[0] as string);
  }

  it('shows only the message of a subscribe caller that reports', async () => {
    http.post(URL, {}).subscribe({
      error: (err: HttpErrorResponse) => notify.error(err, CALLER_KEY)
    });
    refuse();
    await nextMacrotask();

    expect(shownTexts()).toEqual([CALLER_TEXT]);
  });

  it('shows only the message of an await caller that reports in its catch', async () => {
    const call = (async () => {
      try {
        await firstValueFrom(http.post(URL, {}));
      } catch (err) {
        notify.error(err as HttpErrorResponse, CALLER_KEY);
      }
    })();
    refuse();
    await call;
    await nextMacrotask();

    expect(shownTexts()).toEqual([CALLER_TEXT]);
  });

  it('shows only the fixed text of a caller that marks the error reported', async () => {
    http.post(URL, {}).subscribe({
      error: (err: HttpErrorResponse) => {
        notify.markReported(err);
        notify.error(CALLER_KEY);
      }
    });
    refuse();
    await nextMacrotask();

    expect(shownTexts()).toEqual([CALLER_TEXT]);
  });

  it('shows the interceptor message when the caller does not report', async () => {
    http.post(URL, {}).subscribe({ error: () => undefined });
    refuse();
    await nextMacrotask();

    expect(shownTexts()).toEqual(['Conflict from the server']);
  });
});
