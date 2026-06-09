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

  it('POSTs a checkout with the plan key', () => {
    service.checkout('pro').subscribe();
    const req = httpMock.expectOne(`${BILLING_API_V1}/checkout`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ planKey: 'pro' });
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
