import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { BILLING_API_V1, BillingService } from './billing.service';

describe('BillingService', () => {
  let service: BillingService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BillingService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(BillingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs plans', () => {
    service.getPlans().subscribe();
    const req = httpMock.expectOne(`${BILLING_API_V1}/plans`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('GETs the current subscription (nullable)', () => {
    let result: unknown;
    service.getSubscription().subscribe((r) => (result = r));
    const req = httpMock.expectOne(`${BILLING_API_V1}/subscription`);
    expect(req.request.method).toBe('GET');
    req.flush(null);
    expect(result).toBeNull();
  });

  it('GETs the current-period usage summary (nullable)', () => {
    let result: unknown;
    service.getUsage().subscribe((r) => (result = r));
    const req = httpMock.expectOne(`${BILLING_API_V1}/usage`);
    expect(req.request.method).toBe('GET');
    req.flush(null);
    expect(result).toBeNull();
  });

  it('GETs the one-time product catalog', () => {
    service.getProducts().subscribe();
    const req = httpMock.expectOne(`${BILLING_API_V1}/products`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('POSTs a purchase with the product key and optional custom fields', () => {
    service
      .purchase({ productKey: 'donation', amountMinor: 1500, description: 'x' })
      .subscribe();
    const req = httpMock.expectOne(`${BILLING_API_V1}/purchase`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      productKey: 'donation',
      amountMinor: 1500,
      description: 'x'
    });
    req.flush({ provider: 'paddle', url: null, sessionRef: 's' });
  });

  it('POSTs a checkout with the plan key', () => {
    service.checkout('pro').subscribe();
    const req = httpMock.expectOne(`${BILLING_API_V1}/checkout`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ planKey: 'pro' });
    req.flush({ provider: 'paddle', url: 'https://x', sessionRef: 's' });
  });

  it('POSTs a plan change with the target plan key', () => {
    service.changePlan('business').subscribe();
    const req = httpMock.expectOne(`${BILLING_API_V1}/subscription/change`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ planKey: 'business' });
    req.flush({});
  });

  it('POSTs a proration preview without applying the change', () => {
    service.previewChange('business').subscribe();
    const req = httpMock.expectOne(
      `${BILLING_API_V1}/subscription/change/preview`
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ planKey: 'business' });
    req.flush({
      provider: 'yookassa',
      fromPlanKey: 'pro',
      toPlanKey: 'business',
      currency: 'RUB',
      creditMinor: 43000,
      chargeMinor: 129000,
      dueNowMinor: 86000
    });
  });

  it('POSTs a payment-method update with an empty body', () => {
    service.updatePaymentMethod().subscribe();
    const req = httpMock.expectOne(`${BILLING_API_V1}/payment-method`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ provider: 'paddle', url: 'https://x', sessionRef: 's' });
  });

  it('POSTs a cancel with the default period_end mode', () => {
    service.cancel().subscribe();
    const req = httpMock.expectOne(`${BILLING_API_V1}/subscription/cancel`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ mode: 'period_end' });
    req.flush({});
  });

  it('PUTs the billing region', () => {
    service.setRegion('ru').subscribe();
    const req = httpMock.expectOne(`${BILLING_API_V1}/region`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ region: 'ru' });
    req.flush({
      region: 'ru',
      detectedProvider: 'paddle',
      effectiveProvider: 'yookassa'
    });
  });
});
