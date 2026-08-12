import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  InvoiceResponse,
  PaginatedResponse,
  SubscriptionResponse
} from '@app/shared/types';
import { pageParams, type PageRequest } from '@shared/utils/pagination.utils';
import type { CancelMode } from '@features/billing/services/billing.service';

const ADMIN_BILLING_API_V1 = '/api/v1/admin/billing';

/**
 * Thin HTTP wrapper over the admin billing API. Reads and
 * mutations are addressed by entity id across all customers — the server gates
 * them on the CASL `manage Billing` permission, not per-caller scoping.
 */
@Injectable({ providedIn: 'root' })
export class BillingAdminService {
  readonly #http = inject(HttpClient);

  listSubscriptions(
    params: PageRequest = {}
  ): Observable<PaginatedResponse<SubscriptionResponse>> {
    return this.#http.get<PaginatedResponse<SubscriptionResponse>>(
      `${ADMIN_BILLING_API_V1}/subscriptions`,
      { params: pageParams(params) }
    );
  }

  listInvoices(
    params: PageRequest = {}
  ): Observable<PaginatedResponse<InvoiceResponse>> {
    return this.#http.get<PaginatedResponse<InvoiceResponse>>(
      `${ADMIN_BILLING_API_V1}/invoices`,
      { params: pageParams(params) }
    );
  }

  cancelSubscription(
    id: string,
    mode: CancelMode = 'period_end'
  ): Observable<SubscriptionResponse> {
    return this.#http.post<SubscriptionResponse>(
      `${ADMIN_BILLING_API_V1}/subscriptions/${id}/cancel`,
      { mode }
    );
  }

  /**
   * Refund a paid invoice. Omitting `amountMinor` refunds the full amount; a
   * value refunds that partial amount in minor units (server bounds it to
   * `1..invoiceTotal`).
   */
  refundInvoice(id: string, amountMinor?: number): Observable<InvoiceResponse> {
    return this.#http.post<InvoiceResponse>(
      `${ADMIN_BILLING_API_V1}/invoices/${id}/refund`,
      amountMinor === undefined ? {} : { amountMinor }
    );
  }
}
