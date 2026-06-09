import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import type { PlanResponse, SubscriptionResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { BillingStore } from '../../store/billing.store';
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

describe('CheckoutReturnComponent', () => {
  let fixture: ComponentFixture<CheckoutReturnComponent>;
  let storeMock: {
    plans: ReturnType<typeof signal<PlanResponse[]>>;
    currentPlan: ReturnType<typeof signal<PlanResponse | null>>;
    subscription: ReturnType<typeof signal<SubscriptionResponse | null>>;
    hasActiveSubscription: ReturnType<typeof signal<boolean>>;
    refreshSubscription: ReturnType<typeof vi.fn>;
    loadPlans: ReturnType<typeof vi.fn>;
  };

  async function setup(
    mode: 'success' | 'cancel',
    active: boolean
  ): Promise<void> {
    storeMock = {
      plans: signal<PlanResponse[]>(active ? [proPlan] : []),
      currentPlan: signal<PlanResponse | null>(active ? proPlan : null),
      subscription: signal<SubscriptionResponse | null>(
        active ? activeSub : null
      ),
      hasActiveSubscription: signal(active),
      refreshSubscription: vi.fn().mockResolvedValue(active ? activeSub : null),
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
});
