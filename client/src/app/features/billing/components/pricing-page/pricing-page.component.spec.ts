import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import type {
  BillingRegionResponse,
  PlanResponse,
  ProductResponse,
  SubscriptionResponse
} from '@app/shared/types';
import { AuthStore } from '@features/auth/store/auth.store';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { CheckoutRedirectService } from '../../services/checkout-redirect.service';
import { BillingStore } from '../../store/billing.store';
import { readPendingPurchase } from '../../utils/pending-purchase';
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

const reportPack: ProductResponse = {
  id: 'prod-report-pack',
  key: 'report-pack',
  name: 'Report pack',
  description: '30 days of reports access',
  type: 'sku',
  prices: { paddle: { currency: 'USD', amountMinor: 500 } },
  grant: { entitlement: 'reports', durationDays: 30 },
  active: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const donation: ProductResponse = {
  id: 'prod-donation',
  key: 'donation',
  name: 'Donation',
  description: 'Support the project',
  type: 'custom',
  prices: {
    paddle: { currency: 'USD', minAmountMinor: 100, maxAmountMinor: 50000 }
  },
  grant: null,
  active: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

describe('PricingPageComponent', () => {
  let fixture: ComponentFixture<PricingPageComponent>;
  let storeMock: {
    plans: ReturnType<typeof signal<PlanResponse[]>>;
    products: ReturnType<typeof signal<ProductResponse[]>>;
    subscription: ReturnType<typeof signal<SubscriptionResponse | null>>;
    region: ReturnType<typeof signal<BillingRegionResponse | null>>;
    loading: ReturnType<typeof signal<boolean>>;
    working: ReturnType<typeof signal<boolean>>;
    loadPricing: ReturnType<typeof vi.fn>;
    checkout: ReturnType<typeof vi.fn>;
    purchase: ReturnType<typeof vi.fn>;
    setRegion: ReturnType<typeof vi.fn>;
  };
  let authMock: { isAuthenticated: ReturnType<typeof signal<boolean>> };
  let routerMock: { navigate: ReturnType<typeof vi.fn> };
  let redirectMock: { redirect: ReturnType<typeof vi.fn> };

  afterEach(() => {
    sessionStorage.clear();
  });

  async function setup(
    authenticated: boolean,
    products: ProductResponse[] = []
  ): Promise<void> {
    storeMock = {
      plans: signal<PlanResponse[]>([
        plan('free', 'Free', 0),
        plan('pro', 'Pro', 1200),
        plan('business', 'Business', 2900)
      ]),
      products: signal<ProductResponse[]>(products),
      subscription: signal<SubscriptionResponse | null>(null),
      region: signal<BillingRegionResponse | null>(null),
      loading: signal(false),
      working: signal(false),
      loadPricing: vi.fn().mockResolvedValue(undefined),
      checkout: vi.fn().mockResolvedValue(null),
      purchase: vi.fn().mockResolvedValue(null),
      setRegion: vi.fn().mockResolvedValue(true)
    };
    authMock = { isAuthenticated: signal(authenticated) };
    routerMock = { navigate: vi.fn() };
    redirectMock = { redirect: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [PricingPageComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: BillingStore, useValue: storeMock },
        { provide: AuthStore, useValue: authMock },
        { provide: Router, useValue: routerMock },
        { provide: CheckoutRedirectService, useValue: redirectMock }
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

  it('follows the checkout session through the guarded redirect', async () => {
    await setup(true);
    storeMock.checkout.mockResolvedValue({
      provider: 'paddle',
      url: 'https://checkout.paddle.com/pay/1',
      sessionRef: 's1'
    });

    fixture.componentInstance.onChoose('pro');
    await fixture.whenStable();

    expect(redirectMock.redirect).toHaveBeenCalledWith(
      'https://checkout.paddle.com/pay/1'
    );
  });

  it('routes a hosted purchase URL through the guarded redirect, not the success page', async () => {
    await setup(true, [reportPack]);
    storeMock.purchase.mockResolvedValue({
      provider: 'paddle',
      url: 'https://mock-checkout.local/paddle/purchase/s9',
      sessionRef: 's9'
    });

    fixture.componentInstance.onBuy({
      key: reportPack.key,
      price: '$5.00',
      product: reportPack
    });
    await fixture.whenStable();

    expect(redirectMock.redirect).toHaveBeenCalledWith(
      'https://mock-checkout.local/paddle/purchase/s9'
    );
    expect(routerMock.navigate).not.toHaveBeenCalled();
  });

  it('renders the one-time section with product and donation cards for authed users', async () => {
    await setup(true, [reportPack, donation]);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.one-time')).not.toBeNull();
    expect(host.querySelectorAll('nxs-product-card').length).toBe(1);
    expect(host.querySelectorAll('nxs-donation-card').length).toBe(1);
  });

  it('hides the one-time section when the catalog is empty or anonymous', async () => {
    await setup(true, []);
    expect(fixture.nativeElement.querySelector('.one-time')).toBeNull();
    fixture.destroy();

    TestBed.resetTestingModule();
    await setup(false, [reportPack]);
    expect(fixture.nativeElement.querySelector('.one-time')).toBeNull();
  });

  it('starts an sku purchase at the catalog price and parks the session hand-off', async () => {
    await setup(true, [reportPack]);
    storeMock.purchase.mockResolvedValue({
      provider: 'paddle',
      url: null,
      sessionRef: 'session-7'
    });

    fixture.componentInstance.onBuy({
      key: reportPack.key,
      price: '$5.00',
      product: reportPack
    });
    await fixture.whenStable();

    expect(storeMock.purchase).toHaveBeenCalledWith({
      productKey: 'report-pack'
    });
    expect(readPendingPurchase()).toEqual({
      sessionRef: 'session-7',
      productName: 'Report pack',
      amountMinor: 500,
      currency: 'USD'
    });
    // No hosted-checkout URL (client-side completion) → straight to the
    // return page where the webhook confirmation is polled.
    expect(routerMock.navigate).toHaveBeenCalledWith(['/billing/success']);
  });

  it('starts a donation purchase with the chosen amount and note', async () => {
    await setup(true, [donation]);
    storeMock.purchase.mockResolvedValue({
      provider: 'paddle',
      url: null,
      sessionRef: 'session-8'
    });

    fixture.componentInstance.onDonate(donation, {
      amountMinor: 1500,
      note: 'Keep it up'
    });
    await fixture.whenStable();

    expect(storeMock.purchase).toHaveBeenCalledWith({
      productKey: 'donation',
      amountMinor: 1500,
      description: 'Keep it up'
    });
    expect(readPendingPurchase()).toEqual({
      sessionRef: 'session-8',
      productName: 'Donation',
      amountMinor: 1500,
      currency: 'USD'
    });
  });

  it('parks nothing when the purchase fails to start', async () => {
    await setup(true, [reportPack]);

    fixture.componentInstance.onBuy({
      key: reportPack.key,
      price: '$5.00',
      product: reportPack
    });
    await fixture.whenStable();

    expect(readPendingPurchase()).toBeNull();
    expect(routerMock.navigate).not.toHaveBeenCalled();
  });
});
