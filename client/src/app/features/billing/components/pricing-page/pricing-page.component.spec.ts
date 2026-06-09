import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import type {
  BillingRegionResponse,
  PlanResponse,
  SubscriptionResponse
} from '@app/shared/types';
import { AuthStore } from '@features/auth/store/auth.store';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { BillingStore } from '../../store/billing.store';
import { PricingPageComponent } from './pricing-page.component';

function plan(key: string, name: string, amountMinor: number): PlanResponse {
  return {
    id: `plan-${key}`,
    key,
    name,
    description: null,
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: [],
    limits: null,
    trialDays: 0,
    active: true,
    prices: { paddle: { currency: 'USD', amountMinor } },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  };
}

describe('PricingPageComponent', () => {
  let fixture: ComponentFixture<PricingPageComponent>;
  let storeMock: {
    plans: ReturnType<typeof signal<PlanResponse[]>>;
    subscription: ReturnType<typeof signal<SubscriptionResponse | null>>;
    region: ReturnType<typeof signal<BillingRegionResponse | null>>;
    loading: ReturnType<typeof signal<boolean>>;
    working: ReturnType<typeof signal<boolean>>;
    loadPricing: ReturnType<typeof vi.fn>;
    checkout: ReturnType<typeof vi.fn>;
    setRegion: ReturnType<typeof vi.fn>;
  };
  let authMock: { isAuthenticated: ReturnType<typeof signal<boolean>> };
  let routerMock: { navigate: ReturnType<typeof vi.fn> };

  async function setup(authenticated: boolean): Promise<void> {
    storeMock = {
      plans: signal<PlanResponse[]>([
        plan('free', 'Free', 0),
        plan('pro', 'Pro', 1200),
        plan('business', 'Business', 2900)
      ]),
      subscription: signal<SubscriptionResponse | null>(null),
      region: signal<BillingRegionResponse | null>(null),
      loading: signal(false),
      working: signal(false),
      loadPricing: vi.fn().mockResolvedValue(undefined),
      checkout: vi.fn().mockResolvedValue(null),
      setRegion: vi.fn().mockResolvedValue(true)
    };
    authMock = { isAuthenticated: signal(authenticated) };
    routerMock = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [PricingPageComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: BillingStore, useValue: storeMock },
        { provide: AuthStore, useValue: authMock },
        { provide: Router, useValue: routerMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PricingPageComponent);
    fixture.detectChanges();
  }

  it('loads pricing on init and renders three tiers', async () => {
    await setup(true);
    expect(storeMock.loadPricing).toHaveBeenCalledWith(true);
    const cards = fixture.nativeElement.querySelectorAll('nxs-plan-card');
    expect(cards.length).toBe(3);
  });

  it('hides the region control for anonymous visitors', async () => {
    await setup(false);
    expect(fixture.nativeElement.querySelector('.region-control')).toBeNull();
  });

  it('shows the region control once the region is known for authed users', async () => {
    await setup(true);
    storeMock.region.set({
      region: 'auto',
      detectedProvider: 'paddle',
      effectiveProvider: 'paddle'
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.region-control')
    ).not.toBeNull();
  });

  it('routes anonymous visitors to login on choose', async () => {
    await setup(false);
    fixture.componentInstance.onChoose('pro');
    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/login'],
      expect.objectContaining({ queryParams: { returnUrl: '/billing' } })
    );
    expect(storeMock.checkout).not.toHaveBeenCalled();
  });

  it('starts checkout for authenticated users on choose', async () => {
    await setup(true);
    fixture.componentInstance.onChoose('pro');
    expect(storeMock.checkout).toHaveBeenCalledWith('pro');
  });
});
