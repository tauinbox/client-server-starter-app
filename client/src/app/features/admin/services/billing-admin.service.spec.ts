import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { BillingAdminService } from './billing-admin.service';

const ADMIN_BILLING_API_V1 = '/api/v1/admin/billing';

describe('BillingAdminService', () => {
  let service: BillingAdminService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BillingAdminService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(BillingAdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs subscriptions without page params when none are given', () => {
    service.listSubscriptions().subscribe();
    const req = httpMock.expectOne(`${ADMIN_BILLING_API_V1}/subscriptions`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 }
    });
  });

  it('GETs invoices with the requested page and limit', () => {
    service.listInvoices({ page: 3, limit: 25 }).subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === `${ADMIN_BILLING_API_V1}/invoices`
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('3');
    expect(req.request.params.get('limit')).toBe('25');
    req.flush({
      data: [],
      meta: { page: 3, limit: 25, total: 0, totalPages: 0 }
    });
  });

  it('POSTs a cancel with the default period_end mode', () => {
    service.cancelSubscription('sub-1').subscribe();
    const req = httpMock.expectOne(
      `${ADMIN_BILLING_API_V1}/subscriptions/sub-1/cancel`
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ mode: 'period_end' });
    req.flush({});
  });

  it('POSTs an immediate cancel when requested', () => {
    service.cancelSubscription('sub-1', 'immediate').subscribe();
    const req = httpMock.expectOne(
      `${ADMIN_BILLING_API_V1}/subscriptions/sub-1/cancel`
    );
    expect(req.request.body).toEqual({ mode: 'immediate' });
    req.flush({});
  });

  it('POSTs a full refund with an empty body when no amount is given', () => {
    service.refundInvoice('inv-1').subscribe();
    const req = httpMock.expectOne(
      `${ADMIN_BILLING_API_V1}/invoices/inv-1/refund`
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({});
  });

  it('POSTs a partial refund amount when given', () => {
    service.refundInvoice('inv-1', 500).subscribe();
    const req = httpMock.expectOne(
      `${ADMIN_BILLING_API_V1}/invoices/inv-1/refund`
    );
    expect(req.request.body).toEqual({ amountMinor: 500 });
    req.flush({});
  });
});
