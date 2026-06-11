import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import type { InvoiceResponse, SubscriptionResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import { BillingAdminService } from '../services/billing-admin.service';
import { BillingAdminStore } from './billing-admin.store';

const activeSub: SubscriptionResponse = {
  id: 'sub-1',
  customerId: 'cust-1',
  planKey: 'pro',
  provider: 'paddle',
  billingMode: 'fixed',
  status: 'active',
  lifecycleOwner: 'provider',
  currentPeriodStart: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-07-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  trialEnd: null,
  paymentMethodId: 'pm-1',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
};

const paidInvoice: InvoiceResponse = {
  id: 'inv-1',
  customerId: 'cust-1',
  subscriptionId: 'sub-1',
  provider: 'paddle',
  providerInvoiceRef: 'in_1',
  amountMinor: 1200,
  currency: 'USD',
  status: 'paid',
  billingMode: 'fixed',
  kind: 'subscription',
  productId: null,
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  paidAt: '2026-06-01T00:00:00.000Z',
  receiptRef: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
};

describe('BillingAdminStore', () => {
  let billingMock: {
    listSubscriptions: ReturnType<typeof vi.fn>;
    listInvoices: ReturnType<typeof vi.fn>;
    cancelSubscription: ReturnType<typeof vi.fn>;
    refundInvoice: ReturnType<typeof vi.fn>;
  };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  function createStore() {
    return TestBed.inject(BillingAdminStore);
  }

  beforeEach(() => {
    billingMock = {
      listSubscriptions: vi.fn().mockReturnValue(of([activeSub])),
      listInvoices: vi.fn().mockReturnValue(of([paidInvoice])),
      cancelSubscription: vi
        .fn()
        .mockReturnValue(of({ ...activeSub, status: 'canceled' })),
      refundInvoice: vi
        .fn()
        .mockReturnValue(of({ ...paidInvoice, status: 'refunded' }))
    };
    notifyMock = { success: vi.fn(), error: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        BillingAdminStore,
        { provide: BillingAdminService, useValue: billingMock },
        { provide: NotifyService, useValue: notifyMock }
      ]
    });
  });

  it('load populates subscriptions and invoices', async () => {
    const store = createStore();
    await store.load();

    expect(store.subscriptions()).toHaveLength(1);
    expect(store.invoices()).toHaveLength(1);
    expect(store.loading()).toBe(false);
  });

  it('cancelSubscription replaces the row and notifies success', async () => {
    const store = createStore();
    await store.load();

    const ok = await store.cancelSubscription('sub-1', 'immediate');
    expect(ok).toBe(true);
    expect(billingMock.cancelSubscription).toHaveBeenCalledWith(
      'sub-1',
      'immediate'
    );
    expect(store.subscriptions()[0].status).toBe('canceled');
    expect(notifyMock.success).toHaveBeenCalledWith(
      'admin.billing.cancelSuccess'
    );
    expect(store.working()).toBe(false);
  });

  it('refundInvoice replaces the row and notifies success', async () => {
    const store = createStore();
    await store.load();

    const ok = await store.refundInvoice('inv-1');
    expect(ok).toBe(true);
    expect(billingMock.refundInvoice).toHaveBeenCalledWith('inv-1', undefined);
    expect(store.invoices()[0].status).toBe('refunded');
    expect(notifyMock.success).toHaveBeenCalledWith(
      'admin.billing.refundSuccess'
    );
  });

  it('surfaces a cancel error and returns false', async () => {
    billingMock.cancelSubscription.mockReturnValue(
      throwError(() => new Error('boom'))
    );
    const store = createStore();
    await store.load();

    const ok = await store.cancelSubscription('sub-1');
    expect(ok).toBe(false);
    expect(notifyMock.error).toHaveBeenCalled();
    expect(store.subscriptions()[0].status).toBe('active');
    expect(store.working()).toBe(false);
  });

  it('surfaces a load error without throwing', async () => {
    billingMock.listSubscriptions.mockReturnValue(
      throwError(() => new Error('boom'))
    );
    const store = createStore();
    await store.load();

    expect(notifyMock.error).toHaveBeenCalled();
    expect(store.loading()).toBe(false);
  });
});
