import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  CursorPaginatedResponse,
  InvoiceResponse,
  SubscriptionResponse
} from '@app/shared/types';
import { silentContext } from '@core/context-tokens/error-notifications';
import {
  cursorParams,
  type CursorPageRequest
} from '@shared/utils/pagination.utils';
import type { CancelMode } from '@features/billing/services/billing.service';

const ADMIN_BILLING_API_V1 = '/api/v1/admin/billing';

/**
 * Thin HTTP wrapper over the admin billing API. Reads and
 * mutations are addressed by entity id across all customers — the server gates
 * them on the CASL `manage Billing` permission, not per-caller scoping.
 *
 * The stores show the failure of each request, so the requests are silent for
 * the global error interceptor.
 */
@Injectable({ providedIn: 'root' })
export class BillingAdminService {
  readonly #http = inject(HttpClient);

  listSubscriptions(
    request: CursorPageRequest = {}
  ): Observable<CursorPaginatedResponse<SubscriptionResponse>> {
    return this.#http.get<CursorPaginatedResponse<SubscriptionResponse>>(
      `${ADMIN_BILLING_API_V1}/subscriptions`,
      { params: cursorParams(request), context: silentContext() }
    );
  }

  listInvoices(
    request: CursorPageRequest = {}
  ): Observable<CursorPaginatedResponse<InvoiceResponse>> {
    return this.#http.get<CursorPaginatedResponse<InvoiceResponse>>(
      `${ADMIN_BILLING_API_V1}/invoices`,
      { params: cursorParams(request), context: silentContext() }
    );
  }

  cancelSubscription(
    id: string,
    mode: CancelMode = 'period_end'
  ): Observable<SubscriptionResponse> {
    return this.#http.post<SubscriptionResponse>(
      `${ADMIN_BILLING_API_V1}/subscriptions/${id}/cancel`,
      { mode },
      { context: silentContext() }
    );
  }

  /**
   * Refund a paid invoice. Omitting `amountMinor` refunds the remaining
   * unrefunded amount; a value refunds that partial amount in minor units
   * (server bounds it to `1..remaining`).
   */
  refundInvoice(id: string, amountMinor?: number): Observable<InvoiceResponse> {
    return this.#http.post<InvoiceResponse>(
      `${ADMIN_BILLING_API_V1}/invoices/${id}/refund`,
      amountMinor === undefined ? {} : { amountMinor },
      { context: silentContext() }
    );
  }
}
