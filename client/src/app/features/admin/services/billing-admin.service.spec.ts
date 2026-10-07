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

  it('GETs subscriptions without params when none are given', () => {
    service.listSubscriptions().subscribe();
    const req = httpMock.expectOne(`${ADMIN_BILLING_API_V1}/subscriptions`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({
      data: [],
      meta: { nextCursor: null, hasMore: false, limit: 20 }
    });
  });

  it('GETs invoices with the cursor and limit', () => {
    service.listInvoices({ cursor: 'abc', limit: 25 }).subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === `${ADMIN_BILLING_API_V1}/invoices`
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('cursor')).toBe('abc');
    expect(req.request.params.get('limit')).toBe('25');
    req.flush({
      data: [],
      meta: { nextCursor: null, hasMore: false, limit: 25 }
    });
  });

  it('omits the cursor on a first-page request', () => {
    service.listInvoices({ cursor: null, limit: 10 }).subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === `${ADMIN_BILLING_API_V1}/invoices`
    );
    expect(req.request.params.has('cursor')).toBe(false);
    expect(req.request.params.get('limit')).toBe('10');
    req.flush({
      data: [],
      meta: { nextCursor: null, hasMore: false, limit: 10 }
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
