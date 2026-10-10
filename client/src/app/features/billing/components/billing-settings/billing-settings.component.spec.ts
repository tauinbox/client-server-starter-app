import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import type {
  BillingRegionResponse,
  CreditBalanceResponse,
  InvoiceResponse,
  PlanResponse,
  SubscriptionResponse,
  UsageSummaryResponse
} from '@app/shared/types';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants';
import { LayoutService } from '@core/services/layout.service';
import { NotifyService } from '@core/services/notify.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { CheckoutRedirectService } from '../../services/checkout-redirect.service';
import { PaddleCheckoutService } from '../../services/paddle-checkout.service';
import { BillingStore } from '../../store/billing.store';
import { EntitlementsStore } from '../../store/entitlements.store';
import { ChangePlanDialogComponent } from '../change-plan-dialog/change-plan-dialog.component';
import { BillingSettingsComponent } from './billing-settings.component';

const proPlan: PlanResponse = {
  id: 'plan-pro',
  key: 'pro',
  name: 'Pro',
  description: null,
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

describe('BillingSettingsComponent', () => {
  let fixture: ComponentFixture<BillingSettingsComponent>;
  let storeMock: {
    subscription: ReturnType<typeof signal<SubscriptionResponse | null>>;
    entities: ReturnType<typeof signal<InvoiceResponse[]>>;
    hasMore: ReturnType<typeof signal<boolean>>;
    isLoadingMore: ReturnType<typeof signal<boolean>>;
    paymentMethod: ReturnType<typeof signal<null>>;
    usage: ReturnType<typeof signal<UsageSummaryResponse | null>>;
    credits: ReturnType<typeof signal<CreditBalanceResponse | null>>;
    plans: ReturnType<typeof signal<PlanResponse[]>>;
    region: ReturnType<typeof signal<BillingRegionResponse | null>>;
    pageLoading: ReturnType<typeof signal<boolean>>;
    loading: ReturnType<typeof signal<boolean>>;
    working: ReturnType<typeof signal<boolean>>;
    currentPlan: ReturnType<typeof signal<PlanResponse | null>>;
    hasActiveSubscription: ReturnType<typeof signal<boolean>>;
    loadSettings: ReturnType<typeof vi.fn>;
    loadMoreInvoices: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    changePlan: ReturnType<typeof vi.fn>;
    startPaymentMethodUpdate: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { openConfirm: ReturnType<typeof vi.fn> };
  let matDialogMock: { open: ReturnType<typeof vi.fn> };
  let redirectMock: { redirect: ReturnType<typeof vi.fn> };
  let entitlementsMock: {
    load: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let paddleOpen: ReturnType<typeof vi.fn>;
  let router: Router;
  // Set by a test before setup() to land with a Paddle transaction id.
  let transactionId: string | undefined;

  beforeEach(() => {
    paddleOpen = vi.fn();
    transactionId = undefined;
  });

  async function setup(
    hasSub: boolean,
    usage?: UsageSummaryResponse,
    subscription?: SubscriptionResponse,
    credits?: CreditBalanceResponse,
    sessionsLimit: number | null = null
  ): Promise<void> {
    storeMock = {
      subscription: signal<SubscriptionResponse | null>(
        hasSub ? (subscription ?? activeSub) : null
      ),
      entities: signal<InvoiceResponse[]>(hasSub ? [invoice] : []),
      hasMore: signal(false),
      isLoadingMore: signal(false),
      paymentMethod: signal(null),
      usage: signal<UsageSummaryResponse | null>(usage ?? null),
      credits: signal<CreditBalanceResponse | null>(credits ?? null),
      plans: signal<PlanResponse[]>([proPlan]),
      region: signal<BillingRegionResponse | null>(null),
      pageLoading: signal(false),
      loading: signal(false),
      working: signal(false),
      currentPlan: signal<PlanResponse | null>(hasSub ? proPlan : null),
      hasActiveSubscription: signal(hasSub),
      loadSettings: vi.fn().mockResolvedValue(undefined),
      loadMoreInvoices: vi.fn(),
      cancel: vi.fn().mockResolvedValue(true),
      changePlan: vi.fn().mockResolvedValue(true),
      startPaymentMethodUpdate: vi.fn().mockResolvedValue(null)
    };
    entitlementsMock = {
      load: vi.fn().mockResolvedValue(undefined),
      limit: vi.fn().mockReturnValue(signal(sessionsLimit))
    };
    notifyMock = { success: vi.fn(), error: vi.fn() };
    dialogMock = { openConfirm: vi.fn().mockReturnValue(of(true)) };
    redirectMock = { redirect: vi.fn() };
    matDialogMock = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of({ planKey: 'business' })
      })
    };

    await TestBed.configureTestingModule({
      imports: [BillingSettingsComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopMaterialAnimations(),
        provideRouter([]),
        { provide: BillingStore, useValue: storeMock },
        { provide: AuthStore, useValue: { isAuthenticated: signal(true) } },
        { provide: EntitlementsStore, useValue: entitlementsMock },
        { provide: AdaptiveDialogService, useValue: dialogMock },
        { provide: MatDialog, useValue: matDialogMock },
        { provide: LayoutService, useValue: { isHandset: signal(false) } },
        { provide: CheckoutRedirectService, useValue: redirectMock },
        { provide: PaddleCheckoutService, useValue: { open: paddleOpen } },
        { provide: NotifyService, useValue: notifyMock }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    if (transactionId) {
      await router.navigateByUrl(`/?_ptxn=${transactionId}`);
    }
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(BillingSettingsComponent);
    fixture.detectChanges();
  }

  it('loads settings on init and renders the active plan + invoice', async () => {
    await setup(true);
    expect(storeMock.loadSettings).toHaveBeenCalled();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Pro');
    expect(text).toContain('$12.00');
  });

  it('shows the region control in the page header', async () => {
    await setup(true);
    storeMock.region.set({
      region: 'auto',
      detectedProvider: 'paddle',
      effectiveProvider: 'paddle',
      availableProviders: ['paddle', 'yookassa']
    });
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '.settings-header .region-control'
      )
    ).not.toBeNull();
  });

  it('shows the plan device allowance and its eviction semantics', async () => {
    await setup(true, undefined, undefined, undefined, 10);
    expect(entitlementsMock.load).toHaveBeenCalled();
    expect(entitlementsMock.limit).toHaveBeenCalledWith('sessions');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Devices at once: 10');
    expect(text).toContain('drops your oldest session');
  });

  it('falls back to the default allowance when the plan carries no sessions limit', async () => {
    await setup(false);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(`Devices at once: ${MAX_CONCURRENT_SESSIONS}`);
  });

  it('renders billing-boundary dates in UTC regardless of the browser timezone', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      await setup(true, usageSummary);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      // currentPeriodEnd, invoice periodEnd and the usage period end are all
      // 2026-07-01T00:00:00Z. West of UTC an un-zoned pipe renders the previous
      // day ("Jun 30") - the off-by-one the UTC arg prevents.
      expect(text).toContain('Jul 1, 2026');
      expect(text).not.toContain('Jun 30, 2026');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('renders the usage meter when a usage summary is present', async () => {
    await setup(true, usageSummary);
    expect(
      fixture.nativeElement.querySelector('nxs-usage-meter')
    ).not.toBeNull();
  });

  it('hides the usage meter without a usage summary', async () => {
    await setup(true);
    expect(fixture.nativeElement.querySelector('nxs-usage-meter')).toBeNull();
  });

  it('renders the empty state with no subscription', async () => {
    await setup(false);
    expect(fixture.nativeElement.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders the shared list empty state with no invoice', async () => {
    await setup(false);
    const empty = fixture.nativeElement.querySelector('nxs-list-empty');
    expect(empty?.textContent).toContain('No invoices yet.');
  });

  it('confirms then cancels the subscription', async () => {
    await setup(true);
    fixture.componentInstance.onCancel();
    expect(dialogMock.openConfirm).toHaveBeenCalled();
    expect(storeMock.cancel).toHaveBeenCalledWith('period_end');
    expect(dialogMock.openConfirm.mock.calls[0][0].message).not.toContain(
      'Metered usage'
    );
  });

  it('warns that the closing metered period will be charged', async () => {
    await setup(true, undefined, { ...activeSub, billingMode: 'usage' });
    fixture.componentInstance.onCancel();
    expect(dialogMock.openConfirm.mock.calls[0][0].message).toContain(
      'Metered usage recorded so far is charged when the period closes'
    );
  });

  it('opens the change-plan dialog and applies the chosen plan', async () => {
    await setup(true);
    (
      fixture.nativeElement.querySelector(
        '.change-plan-btn'
      ) as HTMLButtonElement
    ).click();

    expect(matDialogMock.open).toHaveBeenCalledWith(
      ChangePlanDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({ subscription: activeSub })
      })
    );
    expect(storeMock.changePlan).toHaveBeenCalledWith('business');
  });

  it('hides the change-plan button when a cancellation is scheduled', async () => {
    await setup(true, undefined, { ...activeSub, cancelAtPeriodEnd: true });
    expect(fixture.nativeElement.querySelector('.change-plan-btn')).toBeNull();
  });

  it('shows the payment-method card with the update action even without a saved method', async () => {
    await setup(true);
    expect(
      fixture.nativeElement.querySelector('.payment-method.none')
    ).not.toBeNull();

    (
      fixture.nativeElement.querySelector(
        '.update-method-btn'
      ) as HTMLButtonElement
    ).click();
    expect(storeMock.startPaymentMethodUpdate).toHaveBeenCalled();
  });

  it('follows the payment-method session through the guarded redirect', async () => {
    await setup(true);
    storeMock.startPaymentMethodUpdate.mockResolvedValue({
      provider: 'paddle',
      url: 'https://checkout.paddle.com/method/1',
      sessionRef: 'sess-1'
    });

    fixture.componentInstance.onUpdatePaymentMethod();
    await fixture.whenStable();

    expect(redirectMock.redirect).toHaveBeenCalledWith(
      'https://checkout.paddle.com/method/1'
    );
  });

  it('hides the payment-method card without a subscription', async () => {
    await setup(false);
    expect(
      fixture.nativeElement.querySelector('.update-method-btn')
    ).toBeNull();
  });

  it('feeds the store balance into the credits wallet card', async () => {
    await setup(true, undefined, undefined, {
      customerId: 'cust-1',
      balanceUnits: 1240,
      updatedAt: '2026-06-01T00:00:00.000Z'
    });

    const card = fixture.nativeElement.querySelector(
      'nxs-credits-card'
    ) as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.querySelector('.credits-units')?.textContent).toContain(
      '1,240'
    );
  });

  describe('with a Paddle transaction id from the default payment link', () => {
    const dropTransactionId = {
      queryParams: { _ptxn: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    };

    it('opens the Paddle checkout and confirms the updated method', async () => {
      transactionId = 'txn_01abc';
      paddleOpen.mockResolvedValue('completed');

      await setup(true);
      await fixture.whenStable();

      expect(paddleOpen).toHaveBeenCalledWith('txn_01abc');
      expect(router.navigate).toHaveBeenCalledWith([], dropTransactionId);
      expect(notifyMock.success).toHaveBeenCalledWith(
        'billing.settings.paymentMethodUpdated'
      );
    });

    it('drops the transaction id without a message when the buyer closes it', async () => {
      transactionId = 'txn_01abc';
      paddleOpen.mockResolvedValue('closed');

      await setup(true);
      await fixture.whenStable();

      expect(router.navigate).toHaveBeenCalledWith([], dropTransactionId);
      expect(notifyMock.success).not.toHaveBeenCalled();
      expect(notifyMock.error).not.toHaveBeenCalled();
    });

    it('reports a payment form that cannot open', async () => {
      transactionId = 'txn_01abc';
      paddleOpen.mockResolvedValue('unavailable');

      await setup(true);
      await fixture.whenStable();

      expect(notifyMock.error).toHaveBeenCalledWith(
        'billing.settings.errorPaymentFormUnavailable'
      );
    });

    it('does not open a checkout without a transaction id', async () => {
      await setup(true);

      expect(paddleOpen).not.toHaveBeenCalled();
    });
  });
});
