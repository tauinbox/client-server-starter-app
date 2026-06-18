import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import type {
  CreditBalanceResponse,
  InvoiceResponse,
  PlanResponse,
  SubscriptionResponse,
  UsageSummaryResponse
} from '@app/shared/types';
import { LayoutService } from '@core/services/layout.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { BillingStore } from '../../store/billing.store';
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
    invoices: ReturnType<typeof signal<InvoiceResponse[]>>;
    paymentMethod: ReturnType<typeof signal<null>>;
    usage: ReturnType<typeof signal<UsageSummaryResponse | null>>;
    credits: ReturnType<typeof signal<CreditBalanceResponse | null>>;
    plans: ReturnType<typeof signal<PlanResponse[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    working: ReturnType<typeof signal<boolean>>;
    currentPlan: ReturnType<typeof signal<PlanResponse | null>>;
    hasActiveSubscription: ReturnType<typeof signal<boolean>>;
    loadSettings: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    changePlan: ReturnType<typeof vi.fn>;
    startPaymentMethodUpdate: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { openConfirm: ReturnType<typeof vi.fn> };
  let matDialogMock: { open: ReturnType<typeof vi.fn> };

  async function setup(
    hasSub: boolean,
    usage?: UsageSummaryResponse,
    subscription?: SubscriptionResponse,
    credits?: CreditBalanceResponse
  ): Promise<void> {
    storeMock = {
      subscription: signal<SubscriptionResponse | null>(
        hasSub ? (subscription ?? activeSub) : null
      ),
      invoices: signal<InvoiceResponse[]>(hasSub ? [invoice] : []),
      paymentMethod: signal(null),
      usage: signal<UsageSummaryResponse | null>(usage ?? null),
      credits: signal<CreditBalanceResponse | null>(credits ?? null),
      plans: signal<PlanResponse[]>([proPlan]),
      loading: signal(false),
      working: signal(false),
      currentPlan: signal<PlanResponse | null>(hasSub ? proPlan : null),
      hasActiveSubscription: signal(hasSub),
      loadSettings: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(true),
      changePlan: vi.fn().mockResolvedValue(true),
      startPaymentMethodUpdate: vi.fn().mockResolvedValue(null)
    };
    dialogMock = { openConfirm: vi.fn().mockReturnValue(of(true)) };
    matDialogMock = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of({ planKey: 'business' })
      })
    };

    await TestBed.configureTestingModule({
      imports: [BillingSettingsComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: BillingStore, useValue: storeMock },
        { provide: AdaptiveDialogService, useValue: dialogMock },
        { provide: MatDialog, useValue: matDialogMock },
        { provide: LayoutService, useValue: { isHandset: signal(false) } }
      ]
    }).compileComponents();

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

  it('confirms then cancels the subscription', async () => {
    await setup(true);
    fixture.componentInstance.onCancel();
    expect(dialogMock.openConfirm).toHaveBeenCalled();
    expect(storeMock.cancel).toHaveBeenCalledWith('period_end');
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
});
