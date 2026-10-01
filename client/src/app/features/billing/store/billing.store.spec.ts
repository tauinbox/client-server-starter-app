import { TestBed } from '@angular/core/testing';
import {
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';
import type {
  CreditBalanceResponse,
  CursorPaginatedResponse,
  InvoiceResponse,
  PlanResponse,
  SubscriptionResponse,
  UsageSummaryResponse
} from '@app/shared/types';
import { DEFAULT_CURSOR_PAGE_SIZE, ErrorKeys } from '@app/shared/constants';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import { BILLING_API_V1, BillingService } from '../services/billing.service';
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
    expect(store.pageLoading()).toBe(false);
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
    expect(store.pageLoading()).toBe(false);
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

  it('refreshInvoices leaves the page flag alone', async () => {
    const store = createStore();
    await store.loadSettings();
    const pending = new Subject<CursorPaginatedResponse<InvoiceResponse>>();
    billingMock.getInvoices.mockReturnValue(pending);

    const done = store.refreshInvoices();

    expect(store.loading()).toBe(true);
    expect(store.pageLoading()).toBe(false);
    pending.next(page([invoice]));
    pending.complete();
    await done;
  });

  it('declares each store member once', () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);
    createStore();
    expect(warn.mock.calls.flat().join(' ')).not.toContain(
      'cannot be overridden'
    );
    warn.mockRestore();
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

describe('BillingStore refusal messages', () => {
  let billingMock: {
    setRegion: ReturnType<typeof vi.fn>;
    changePlan: ReturnType<typeof vi.fn>;
  };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  function refusal(errorKey: string, message: string): HttpErrorResponse {
    return new HttpErrorResponse({
      status: 409,
      error: { message, errorKey, statusCode: 409 }
    });
  }

  beforeEach(() => {
    billingMock = { setRegion: vi.fn(), changePlan: vi.fn() };
    snackBarMock = { open: vi.fn() };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        BillingStore,
        { provide: BillingService, useValue: billingMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    });
  });

  it('shows the reason of a refused region change, not the generic fallback', async () => {
    billingMock.setRegion.mockReturnValue(
      throwError(() =>
        refusal(
          ErrorKeys.BILLING.REGION_CHANGE_BLOCKED,
          'Cancel the current subscription before changing your billing region.'
        )
      )
    );

    const ok = await TestBed.inject(BillingStore).setRegion('ru');

    expect(ok).toBe(false);
    expect(snackBarMock.open).toHaveBeenCalledTimes(1);
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Cancel your current subscription before you change the billing region.',
      'Close'
    );
  });

  it('shows the reason of a plan change refused after the payment, not an invitation to retry', async () => {
    billingMock.changePlan.mockReturnValue(
      throwError(() =>
        refusal(
          ErrorKeys.BILLING.PLAN_CHANGE_PAYMENT_CONFLICT,
          'This subscription changed while the payment was in flight; the plan was not switched. Any amount charged is on your invoices.'
        )
      )
    );

    const ok = await TestBed.inject(BillingStore).changePlan('business');

    expect(ok).toBe(false);
    expect(snackBarMock.open).toHaveBeenCalledTimes(1);
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'The subscription changed while the payment was in progress, so the plan was not switched. Any amount charged is on your invoices.',
      'Close'
    );
  });
});

describe('Billing requests through the error interceptor', () => {
  type Store = InstanceType<typeof BillingStore>;

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
          request.url === `${BILLING_API_V1}${path}`
      )
      .flush(
        { message: 'Refused', statusCode: 409 },
        { status: 409, statusText: 'Conflict' }
      );
  }

  beforeEach(() => {
    notifyMock = { success: vi.fn(), error: vi.fn(), warn: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        BillingStore,
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

  it.each<[string, (store: Store) => Promise<unknown>, string, string, string]>(
    [
      [
        'loadPlans',
        (store) => store.loadPlans(),
        'GET',
        '/plans',
        'billing.errors.loadFailed'
      ],
      [
        'loadRegion',
        (store) => store.loadRegion(),
        'GET',
        '/region',
        'billing.errors.loadFailed'
      ],
      [
        'loadProducts',
        (store) => store.loadProducts(),
        'GET',
        '/products',
        'billing.errors.loadFailed'
      ],
      [
        'refreshSubscription',
        (store) => store.refreshSubscription(),
        'GET',
        '/subscription',
        'billing.errors.loadFailed'
      ],
      [
        'refreshInvoices',
        (store) => store.refreshInvoices(),
        'GET',
        '/invoices',
        'billing.errors.loadFailed'
      ],
      [
        'checkout',
        (store) => store.checkout('pro'),
        'POST',
        '/checkout',
        'billing.errors.checkoutFailed'
      ],
      [
        'purchase',
        (store) => store.purchase({ productKey: 'report-pack' }),
        'POST',
        '/purchase',
        'billing.errors.purchaseFailed'
      ],
      [
        'changePlan',
        (store) => store.changePlan('business'),
        'POST',
        '/subscription/change',
        'billing.errors.changeFailed'
      ],
      [
        'startPaymentMethodUpdate',
        (store) => store.startPaymentMethodUpdate(),
        'POST',
        '/payment-method',
        'billing.errors.paymentMethodFailed'
      ],
      [
        'cancel',
        (store) => store.cancel(),
        'POST',
        '/subscription/cancel',
        'billing.errors.cancelFailed'
      ],
      [
        'setRegion',
        (store) => store.setRegion('ru'),
        'PUT',
        '/region',
        'billing.errors.regionFailed'
      ]
    ]
  )(
    'a refused %s shows one notification',
    async (_name, run, method, path, fallbackKey) => {
      const done = run(TestBed.inject(BillingStore));
      refuse(method, path);
      await done;

      expect(notifyMock.warn).not.toHaveBeenCalled();
      expect(notifyMock.error).toHaveBeenCalledTimes(1);
      expect(notifyMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ status: 409 }),
        fallbackKey
      );
    }
  );

  it('a settings load with every read refused shows one notification', async () => {
    const done = TestBed.inject(BillingStore).loadSettings();
    httpMock
      .expectOne((request) => request.url === `${BILLING_API_V1}/invoices`)
      .flush(page([invoice]));
    for (const path of [
      '/subscription',
      '/payment-method',
      '/usage',
      '/credits',
      '/plans',
      '/region'
    ]) {
      refuse('GET', path);
    }
    await done;

    expect(notifyMock.error).toHaveBeenCalledTimes(1);
  });

  it('a settings load keeps the page flag on until every read lands', async () => {
    const store = TestBed.inject(BillingStore);
    const done = store.loadSettings();
    httpMock
      .expectOne((request) => request.url === `${BILLING_API_V1}/invoices`)
      .flush(page([invoice]));
    await Promise.resolve();
    await Promise.resolve();

    expect(store.loading()).toBe(false);
    expect(store.pageLoading()).toBe(true);

    for (const [path, body] of [
      ['/subscription', activeSub],
      ['/payment-method', null],
      ['/usage', usageSummary],
      ['/credits', creditBalance],
      ['/plans', [proPlan]],
      ['/region', null]
    ] as const) {
      httpMock
        .expectOne((request) => request.url === `${BILLING_API_V1}${path}`)
        .flush(body);
    }
    await done;

    expect(store.pageLoading()).toBe(false);
  });

  it('a refused next page of invoices shows one notification', async () => {
    const store = TestBed.inject(BillingStore);
    const firstPage = store.refreshInvoices();
    httpMock
      .expectOne((request) => request.url === `${BILLING_API_V1}/invoices`)
      .flush(page([invoice], 'cur-1'));
    await firstPage;

    store.loadMoreInvoices();
    refuse('GET', '/invoices');
    await Promise.resolve();
    await Promise.resolve();

    expect(notifyMock.error).toHaveBeenCalledTimes(1);
  });

  it('a refused proration preview shows no notification, because the dialog shows it', () => {
    TestBed.inject(BillingService)
      .previewChange('business')
      .subscribe({ error: vi.fn() });
    refuse('POST', '/subscription/change/preview');

    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('a refused entitlements read keeps the interceptor notification, because no caller shows it', () => {
    TestBed.inject(BillingService)
      .getEntitlements()
      .subscribe({ error: vi.fn() });
    refuse('GET', '/entitlements');

    expect(notifyMock.error).toHaveBeenCalledTimes(1);
  });
});
