import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { BillingInvoicesStore } from './billing-invoices.store';
import { BillingSubscriptionsStore } from './billing-subscriptions.store';

const ADMIN_BILLING_API_V1 = '/api/v1/admin/billing';

describe('Admin billing requests through the error interceptor', () => {
  let httpMock: HttpTestingController;
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };

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

  async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    notifyMock = { success: vi.fn(), error: vi.fn(), warn: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        BillingSubscriptionsStore,
        BillingInvoicesStore,
        { provide: NotifyService, useValue: notifyMock },
        {
          provide: AuthStore,
          useValue: { setRules: vi.fn(), setMfaMandatory: vi.fn() }
        }
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('a refused subscription list shows one notification', async () => {
    TestBed.inject(BillingSubscriptionsStore).load();
    refuse('GET', '/subscriptions');
    await settle();

    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(notifyMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
      'admin.billing.errors.loadFailed'
    );
  });

  it('a refused invoice list shows one notification', async () => {
    TestBed.inject(BillingInvoicesStore).load();
    refuse('GET', '/invoices');
    await settle();

    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(notifyMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
      'admin.billing.errors.loadFailed'
    );
  });

  it('a refused cancel shows one notification', async () => {
    const done = TestBed.inject(BillingSubscriptionsStore).cancelSubscription(
      'sub-1'
    );
    refuse('POST', '/subscriptions/sub-1/cancel');

    expect(await done).toBe(false);
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(notifyMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
      'admin.billing.errors.cancelFailed'
    );
  });

  it('a refused refund shows one notification', async () => {
    const done = TestBed.inject(BillingInvoicesStore).refundInvoice('inv-1');
    refuse('POST', '/invoices/inv-1/refund');

    expect(await done).toBe(false);
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(notifyMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
      'admin.billing.errors.refundFailed'
    );
  });
});
