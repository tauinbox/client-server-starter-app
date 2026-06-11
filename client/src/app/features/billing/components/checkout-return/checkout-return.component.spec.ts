import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import type {
  InvoiceResponse,
  PlanResponse,
  SubscriptionResponse
} from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { BillingStore } from '../../store/billing.store';
import {
  readPendingPurchase,
  storePendingPurchase
} from '../../utils/pending-purchase';
import { CheckoutReturnComponent } from './checkout-return.component';

const proPlan: PlanResponse = {
  id: 'plan-pro',
  key: 'pro',
  name: 'Pro',
  description: null,
  billingMode: 'fixed',
  interval: 'month',
  meterKey: null,
  entitlements: [],
  limits: null,
  trialDays: 0,
  active: true,
  prices: {},
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const activeSub = {
  currentPeriodEnd: '2026-07-01T00:00:00.000Z'
} as SubscriptionResponse;

const paidPurchaseInvoice = {
  id: 'inv-1',
  providerInvoiceRef: 'session-1',
  status: 'paid',
  kind: 'one_time'
} as InvoiceResponse;

describe('CheckoutReturnComponent', () => {
  let fixture: ComponentFixture<CheckoutReturnComponent>;
  let storeMock: {
    plans: ReturnType<typeof signal<PlanResponse[]>>;
    currentPlan: ReturnType<typeof signal<PlanResponse | null>>;
    subscription: ReturnType<typeof signal<SubscriptionResponse | null>>;
    hasActiveSubscription: ReturnType<typeof signal<boolean>>;
    refreshSubscription: ReturnType<typeof vi.fn>;
    refreshInvoices: ReturnType<typeof vi.fn>;
    loadPlans: ReturnType<typeof vi.fn>;
  };

  afterEach(() => {
    sessionStorage.clear();
  });

  async function setup(
    mode: 'success' | 'cancel',
    active: boolean,
    invoices: InvoiceResponse[] = []
  ): Promise<void> {
    storeMock = {
      plans: signal<PlanResponse[]>(active ? [proPlan] : []),
      currentPlan: signal<PlanResponse | null>(active ? proPlan : null),
      subscription: signal<SubscriptionResponse | null>(
        active ? activeSub : null
      ),
      hasActiveSubscription: signal(active),
      refreshSubscription: vi.fn().mockResolvedValue(active ? activeSub : null),
      refreshInvoices: vi.fn().mockResolvedValue(invoices),
      loadPlans: vi.fn().mockResolvedValue(undefined)
    };

    await TestBed.configureTestingModule({
      imports: [CheckoutReturnComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: BillingStore, useValue: storeMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CheckoutReturnComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('confirms an active subscription on success return', async () => {
    await setup('success', true);
    expect(storeMock.refreshSubscription).toHaveBeenCalled();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Pro');
  });

  it('shows the canceled state without polling on cancel return', async () => {
    await setup('cancel', false);
    expect(storeMock.refreshSubscription).not.toHaveBeenCalled();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Checkout canceled');
  });

  it('confirms a one-time purchase by its provider payment reference and clears the hand-off', async () => {
    storePendingPurchase({
      sessionRef: 'session-1',
      productName: 'Report pack',
      amountMinor: 500,
      currency: 'USD'
    });

    await setup('success', false, [paidPurchaseInvoice]);

    expect(storeMock.refreshInvoices).toHaveBeenCalled();
    expect(storeMock.refreshSubscription).not.toHaveBeenCalled();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Thank you for your purchase!');
    expect(text).toContain('Report pack');
    expect(text).toContain('$5.00');
    expect(readPendingPurchase()).toBeNull();
  });

  it('keeps polling subscription-style when no purchase is pending', async () => {
    await setup('success', true, [paidPurchaseInvoice]);
    expect(storeMock.refreshSubscription).toHaveBeenCalled();
    expect(storeMock.refreshInvoices).not.toHaveBeenCalled();
  });

  it('clears a stale purchase hand-off on a cancel return', async () => {
    storePendingPurchase({
      sessionRef: 'session-9',
      productName: 'Donation',
      amountMinor: 1500,
      currency: 'USD'
    });
    await setup('cancel', false);
    expect(readPendingPurchase()).toBeNull();
  });
});
