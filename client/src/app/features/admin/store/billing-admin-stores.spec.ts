import type { MockInstance } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DEFAULT_CURSOR_PAGE_SIZE } from '@app/shared/constants';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { BillingInvoicesStore } from './billing-invoices.store';
import { BillingSubscriptionsStore } from './billing-subscriptions.store';

const ADMIN_BILLING_API_V1 = '/api/v1/admin/billing';

describe('Admin billing requests through the error interceptor', () => {
  let httpMock: HttpTestingController;
  let notifyError: MockInstance<NotifyService['error']>;

  function refuse(method: string, path: string): void {
    httpMock
      .expectOne(
        (request) =>
          request.method === method &&
          request.url === `${ADMIN_BILLING_API_V1}${path}`
      )
      .flush(
        { message: 'Refused', statusCode: 409 },
        { status: 409, statusText: 'Conflict' }
      );
  }

  function answerList(path: string): void {
    httpMock
      .expectOne(
        (request) =>
          request.method === 'GET' &&
          request.url === `${ADMIN_BILLING_API_V1}${path}`
      )
      .flush({
        data: [],
        meta: {
          nextCursor: null,
          hasMore: false,
          limit: DEFAULT_CURSOR_PAGE_SIZE
        }
      });
  }

  // The interceptor shows its message in a later macrotask.
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        BillingSubscriptionsStore,
        BillingInvoicesStore,
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        {
          provide: AuthStore,
          useValue: { setRules: vi.fn(), setMfaMandatory: vi.fn() }
        }
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
    notifyError = vi.spyOn(TestBed.inject(NotifyService), 'error');
  });

  afterEach(() => httpMock.verify());

  it('a refused subscription list shows one notification', async () => {
    TestBed.inject(BillingSubscriptionsStore).load();
    refuse('GET', '/subscriptions');
    await settle();

    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
      'admin.billing.errorLoadFailed'
    );
  });

  it('a refused invoice list shows one notification', async () => {
    TestBed.inject(BillingInvoicesStore).load();
    refuse('GET', '/invoices');
    await settle();

    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
      'admin.billing.errorLoadFailed'
    );
  });

  it('a refused cancel shows one notification and reloads the list', async () => {
    const done = TestBed.inject(BillingSubscriptionsStore).cancelSubscription(
      'sub-1'
    );

    refuse('POST', '/subscriptions/sub-1/cancel');

    expect(await done).toBe(false);
    answerList('/subscriptions');
    await settle();
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
      'admin.billing.errorCancelFailed'
    );
  });

  it('a refused refund shows one notification and reloads the list', async () => {
    const done = TestBed.inject(BillingInvoicesStore).refundInvoice('inv-1');

    refuse('POST', '/invoices/inv-1/refund');

    expect(await done).toBe(false);
    answerList('/invoices');
    await settle();
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
      'admin.billing.errorRefundFailed'
    );
  });

  it('a refund that the provider failed does not reload the list', async () => {
    const done = TestBed.inject(BillingInvoicesStore).refundInvoice('inv-1');

    httpMock
      .expectOne(`${ADMIN_BILLING_API_V1}/invoices/inv-1/refund`)
      .flush(
        { message: 'Provider failed', statusCode: 502 },
        { status: 502, statusText: 'Bad Gateway' }
      );

    expect(await done).toBe(false);
    httpMock.expectNone(
      (request) => request.url === `${ADMIN_BILLING_API_V1}/invoices`
    );
  });
});
