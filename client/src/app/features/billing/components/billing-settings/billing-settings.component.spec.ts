import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import type {
  InvoiceResponse,
  PlanResponse,
  SubscriptionResponse
} from '@app/shared/types';
import { LayoutService } from '@core/services/layout.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { BillingStore } from '../../store/billing.store';
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
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  paidAt: '2026-06-01T00:00:00.000Z',
  receiptRef: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
};

describe('BillingSettingsComponent', () => {
  let fixture: ComponentFixture<BillingSettingsComponent>;
  let storeMock: {
    subscription: ReturnType<typeof signal<SubscriptionResponse | null>>;
    invoices: ReturnType<typeof signal<InvoiceResponse[]>>;
    paymentMethod: ReturnType<typeof signal<null>>;
    loading: ReturnType<typeof signal<boolean>>;
    working: ReturnType<typeof signal<boolean>>;
    currentPlan: ReturnType<typeof signal<PlanResponse | null>>;
    hasActiveSubscription: ReturnType<typeof signal<boolean>>;
    loadSettings: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { openConfirm: ReturnType<typeof vi.fn> };

  async function setup(hasSub: boolean): Promise<void> {
    storeMock = {
      subscription: signal<SubscriptionResponse | null>(
        hasSub ? activeSub : null
      ),
      invoices: signal<InvoiceResponse[]>(hasSub ? [invoice] : []),
      paymentMethod: signal(null),
      loading: signal(false),
      working: signal(false),
      currentPlan: signal<PlanResponse | null>(hasSub ? proPlan : null),
      hasActiveSubscription: signal(hasSub),
      loadSettings: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(true)
    };
    dialogMock = { openConfirm: vi.fn().mockReturnValue(of(true)) };

    await TestBed.configureTestingModule({
      imports: [BillingSettingsComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: BillingStore, useValue: storeMock },
        { provide: AdaptiveDialogService, useValue: dialogMock },
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
});
