import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import type {
  CreditBalanceResponse,
  CursorPaginatedResponse,
  InvoiceResponse,
  PlanResponse,
  SubscriptionResponse,
  UsageSummaryResponse
} from '@app/shared/types';
import { DEFAULT_CURSOR_PAGE_SIZE } from '@app/shared/constants';
import { NotifyService } from '@core/services/notify.service';
import { BillingService } from '../services/billing.service';
import { BillingStore } from './billing.store';

function page<T>(
  data: T[],
  nextCursor: string | null = null
): CursorPaginatedResponse<T> {
  return {
    data,
    meta: {
      nextCursor,
      hasMore: nextCursor !== null,
      limit: DEFAULT_CURSOR_PAGE_SIZE
    }
  };
}

const proPlan: PlanResponse = {
  id: 'plan-pro',
  key: 'pro',
  name: 'Pro',
  description: 'For growing teams',
  billingMode: 'fixed',
  interval: 'month',
  meterKey: null,
  entitlements: ['reports'],
  limits: null,
  trialDays: 0,
  active: true,
  prices: { paddle: { currency: 'USD', amountMinor: 1200 } },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

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

const invoice: InvoiceResponse = {
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

const creditBalance: CreditBalanceResponse = {
  customerId: 'cust-1',
  balanceUnits: 1240,
  updatedAt: '2026-06-01T00:00:00.000Z'
};

const usageSummary: UsageSummaryResponse = {
  subscriptionId: 'sub-1',
  meterKey: 'api_calls',
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  totalUnits: 142,
  includedUnits: 100,
  billableUnits: 42,
  unitPriceMinor: 200,
  amountMinor: 8400,
  currency: 'USD'
};

describe('BillingStore', () => {
  let billingMock: {
    getPlans: ReturnType<typeof vi.fn>;
    getProducts: ReturnType<typeof vi.fn>;
    getSubscription: ReturnType<typeof vi.fn>;
    getInvoices: ReturnType<typeof vi.fn>;
    getPaymentMethod: ReturnType<typeof vi.fn>;
    getUsage: ReturnType<typeof vi.fn>;
    getCredits: ReturnType<typeof vi.fn>;
    getRegion: ReturnType<typeof vi.fn>;
    checkout: ReturnType<typeof vi.fn>;
    purchase: ReturnType<typeof vi.fn>;
    changePlan: ReturnType<typeof vi.fn>;
    updatePaymentMethod: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    setRegion: ReturnType<typeof vi.fn>;
  };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  function createStore() {
    return TestBed.inject(BillingStore);
  }

  beforeEach(() => {
    billingMock = {
      getPlans: vi.fn().mockReturnValue(of([proPlan])),
      getSubscription: vi.fn().mockReturnValue(of(activeSub)),
      getInvoices: vi.fn().mockReturnValue(of(page([invoice]))),
      getPaymentMethod: vi.fn().mockReturnValue(of(null)),
      getUsage: vi.fn().mockReturnValue(of(usageSummary)),
      getCredits: vi.fn().mockReturnValue(of(creditBalance)),
      getRegion: vi.fn().mockReturnValue(
        of({
          region: 'auto',
          detectedProvider: 'paddle',
          effectiveProvider: 'paddle'
        })
      ),
      checkout: vi
        .fn()
        .mockReturnValue(
          of({ provider: 'paddle', url: 'https://x', sessionRef: 's' })
        ),
      getProducts: vi.fn().mockReturnValue(of([])),
      purchase: vi
        .fn()
        .mockReturnValue(
          of({ provider: 'paddle', url: null, sessionRef: 'ot-1' })
        ),
      changePlan: vi.fn().mockReturnValue(
        of({
          ...activeSub,
          planKey: 'business'
        } satisfies SubscriptionResponse)
      ),
      updatePaymentMethod: vi
        .fn()
        .mockReturnValue(
          of({ provider: 'paddle', url: 'https://pm', sessionRef: 'pm-s' })
        ),
      cancel: vi
        .fn()
        .mockReturnValue(of({ ...activeSub, cancelAtPeriodEnd: true })),
      setRegion: vi.fn().mockReturnValue(
        of({
          region: 'ru',
          detectedProvider: 'paddle',
          effectiveProvider: 'yookassa'
        })
      )
    };
    notifyMock = { success: vi.fn(), error: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        BillingStore,
        { provide: BillingService, useValue: billingMock },
        { provide: NotifyService, useValue: notifyMock }
      ]
    });
  });

  it('loadSettings populates state and derives the current plan', async () => {
    const store = createStore();
    await store.loadSettings();

    expect(store.plans()).toHaveLength(1);
    expect(store.subscription()).toEqual(activeSub);
    expect(store.entities()).toHaveLength(1);
    expect(store.usage()).toEqual(usageSummary);
    expect(store.credits()).toEqual(creditBalance);
    expect(store.currentPlan()?.key).toBe('pro');
    expect(store.hasActiveSubscription()).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it.each([
    ['trialing', true],
    ['active', true],
    ['past_due', true],
    ['incomplete', false],
    ['canceled', false]
  ] as const)('hasActiveSubscription is %s -> %s', async (status, expected) => {
    billingMock.getSubscription.mockReturnValue(
      of({ ...activeSub, status } satisfies SubscriptionResponse)
    );
    const store = createStore();
    await store.loadSettings();

    expect(store.hasActiveSubscription()).toBe(expected);
  });

  it('hasActiveSubscription is false without a subscription', async () => {
    billingMock.getSubscription.mockReturnValue(of(null));
    const store = createStore();
    await store.loadSettings();

    expect(store.hasActiveSubscription()).toBe(false);
  });

  it('loadSettings keeps the slices that loaded when one request fails', async () => {
    billingMock.getCredits.mockReturnValue(throwError(() => new Error('503')));
    const store = createStore();
    await store.loadSettings();

    expect(store.credits()).toBeNull();
    expect(store.plans()).toHaveLength(1);
    expect(store.subscription()).toEqual(activeSub);
    expect(store.entities()).toHaveLength(1);
    expect(store.usage()).toEqual(usageSummary);
    expect(store.loading()).toBe(false);
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(notifyMock.error).toHaveBeenCalledWith(
      expect.anything(),
      'billing.errors.loadFailed'
    );
  });

  it('loadSettings reports a single toast when several requests fail', async () => {
    billingMock.getCredits.mockReturnValue(throwError(() => new Error('503')));
    billingMock.getUsage.mockReturnValue(throwError(() => new Error('503')));
    const store = createStore();
    await store.loadSettings();

    expect(store.plans()).toHaveLength(1);
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
  });

  it('loadPricing skips authed-only calls for anonymous visitors', async () => {
    const store = createStore();
    await store.loadPricing(false);

    expect(billingMock.getPlans).toHaveBeenCalled();
    expect(billingMock.getRegion).not.toHaveBeenCalled();
    expect(billingMock.getSubscription).not.toHaveBeenCalled();
    expect(billingMock.getProducts).not.toHaveBeenCalled();
  });

  it('loadPricing loads the one-time catalog for authenticated callers', async () => {
    const store = createStore();
    await store.loadPricing(true);

    expect(billingMock.getProducts).toHaveBeenCalled();
  });

  it('purchase returns the provider session', async () => {
    const store = createStore();
    const session = await store.purchase({ productKey: 'report-pack' });
    expect(session?.sessionRef).toBe('ot-1');
    expect(billingMock.purchase).toHaveBeenCalledWith({
      productKey: 'report-pack'
    });
    expect(store.working()).toBe(false);
  });

  it('surfaces a purchase error and returns null', async () => {
    billingMock.purchase.mockReturnValue(throwError(() => new Error('boom')));
    const store = createStore();
    const session = await store.purchase({ productKey: 'report-pack' });
    expect(session).toBeNull();
    expect(notifyMock.error).toHaveBeenCalledWith(
      expect.anything(),
      'billing.errors.purchaseFailed'
    );
  });

  it('refreshInvoices patches the invoice list', async () => {
    const store = createStore();
    const invoices = await store.refreshInvoices();
    expect(invoices).toHaveLength(1);
    expect(store.entities()).toHaveLength(1);
  });

  it('loadSettings asks for the first page of invoices', async () => {
    billingMock.getInvoices.mockReturnValue(of(page([invoice], 'cur-1')));
    const store = createStore();
    await store.loadSettings();

    expect(billingMock.getInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null })
    );
    expect(store.entities()).toHaveLength(1);
    expect(store.hasMore()).toBe(true);
    expect(store.nextCursor()).toBe('cur-1');
  });

  it('loadMoreInvoices appends the next page behind the cursor', async () => {
    billingMock.getInvoices.mockReturnValue(of(page([invoice], 'cur-1')));
    const store = createStore();
    await store.loadSettings();

    const second = { ...invoice, id: 'inv-2' };
    billingMock.getInvoices.mockReturnValue(of(page([second])));
    store.loadMoreInvoices();
    await Promise.resolve();
    await Promise.resolve();

    expect(billingMock.getInvoices).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cur-1' })
    );
    // Appended, not replaced.
    expect(store.entities()).toHaveLength(2);
    expect(store.hasMore()).toBe(false);
  });

  it('ignores loadMoreInvoices once the server reports no more rows', async () => {
    billingMock.getInvoices.mockReturnValue(of(page([invoice])));
    const store = createStore();
    await store.loadSettings();
    const callsAfterLoad = billingMock.getInvoices.mock.calls.length;

    store.loadMoreInvoices();
    await Promise.resolve();

    expect(billingMock.getInvoices).toHaveBeenCalledTimes(callsAfterLoad);
  });

  it('refreshInvoices restarts from the first page', async () => {
    billingMock.getInvoices.mockReturnValue(of(page([invoice], 'cur-1')));
    const store = createStore();
    await store.loadSettings();

    await store.refreshInvoices();

    expect(billingMock.getInvoices).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null })
    );
  });

  it('checkout returns the provider session', async () => {
    const store = createStore();
    const session = await store.checkout('pro');
    expect(session?.url).toBe('https://x');
    expect(store.working()).toBe(false);
  });

  it('cancel updates the subscription and notifies success', async () => {
    const store = createStore();
    const ok = await store.cancel('period_end');
    expect(ok).toBe(true);
    expect(store.subscription()?.cancelAtPeriodEnd).toBe(true);
    expect(notifyMock.success).toHaveBeenCalled();
  });

  it('changePlan patches the subscription and refreshes invoices + usage', async () => {
    const changeInvoice = { ...invoice, id: 'inv-2', status: 'refunded' };
    billingMock.getInvoices.mockReturnValue(of(page([invoice, changeInvoice])));
    const store = createStore();

    const ok = await store.changePlan('business');

    expect(ok).toBe(true);
    expect(billingMock.changePlan).toHaveBeenCalledWith('business');
    expect(store.subscription()?.planKey).toBe('business');
    expect(store.entities()).toHaveLength(2);
    expect(billingMock.getUsage).toHaveBeenCalled();
    expect(notifyMock.success).toHaveBeenCalled();
    expect(store.working()).toBe(false);
  });

  it('surfaces a changePlan error without refreshing invoices', async () => {
    billingMock.changePlan.mockReturnValue(throwError(() => new Error('409')));
    const store = createStore();

    const ok = await store.changePlan('business');

    expect(ok).toBe(false);
    expect(notifyMock.error).toHaveBeenCalled();
    expect(billingMock.getInvoices).not.toHaveBeenCalled();
    expect(store.working()).toBe(false);
  });

  it('startPaymentMethodUpdate returns the provider session', async () => {
    const store = createStore();
    const session = await store.startPaymentMethodUpdate();
    expect(session?.url).toBe('https://pm');
    expect(store.working()).toBe(false);
  });

  it('surfaces a payment-method update error and returns null', async () => {
    billingMock.updatePaymentMethod.mockReturnValue(
      throwError(() => new Error('404'))
    );
    const store = createStore();
    const session = await store.startPaymentMethodUpdate();
    expect(session).toBeNull();
    expect(notifyMock.error).toHaveBeenCalled();
  });

  it('surfaces a checkout error and returns null', async () => {
    billingMock.checkout.mockReturnValue(throwError(() => new Error('boom')));
    const store = createStore();
    const session = await store.checkout('pro');
    expect(session).toBeNull();
    expect(notifyMock.error).toHaveBeenCalled();
  });

  it('setRegion stores the updated region', async () => {
    const store = createStore();
    await store.setRegion('ru');
    expect(store.region()?.effectiveProvider).toBe('yookassa');
  });
});
