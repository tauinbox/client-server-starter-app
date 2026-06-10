import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  BillingRegion,
  BillingRegionResponse,
  CheckoutSessionResponse,
  InvoiceResponse,
  PaymentMethodResponse,
  PlanResponse,
  SubscriptionResponse,
  UsageSummaryResponse
} from '@app/shared/types';

export const BILLING_API_V1 = '/api/v1/billing';

export type CancelMode = 'period_end' | 'immediate';

/**
 * Thin HTTP wrapper over the user billing API (design §11). Read endpoints
 * for subscription, payment method and usage return `null` when none exists.
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  readonly #http = inject(HttpClient);

  getPlans(): Observable<PlanResponse[]> {
    return this.#http.get<PlanResponse[]>(`${BILLING_API_V1}/plans`);
  }

  getSubscription(): Observable<SubscriptionResponse | null> {
    return this.#http.get<SubscriptionResponse | null>(
      `${BILLING_API_V1}/subscription`
    );
  }

  getInvoices(): Observable<InvoiceResponse[]> {
    return this.#http.get<InvoiceResponse[]>(`${BILLING_API_V1}/invoices`);
  }

  getUsage(): Observable<UsageSummaryResponse | null> {
    return this.#http.get<UsageSummaryResponse | null>(
      `${BILLING_API_V1}/usage`
    );
  }

  getPaymentMethod(): Observable<PaymentMethodResponse | null> {
    return this.#http.get<PaymentMethodResponse | null>(
      `${BILLING_API_V1}/payment-method`
    );
  }

  checkout(planKey: string): Observable<CheckoutSessionResponse> {
    return this.#http.post<CheckoutSessionResponse>(
      `${BILLING_API_V1}/checkout`,
      { planKey }
    );
  }

  cancel(mode: CancelMode = 'period_end'): Observable<SubscriptionResponse> {
    return this.#http.post<SubscriptionResponse>(
      `${BILLING_API_V1}/subscription/cancel`,
      { mode }
    );
  }

  getRegion(): Observable<BillingRegionResponse> {
    return this.#http.get<BillingRegionResponse>(`${BILLING_API_V1}/region`);
  }

  setRegion(region: BillingRegion): Observable<BillingRegionResponse> {
    return this.#http.put<BillingRegionResponse>(`${BILLING_API_V1}/region`, {
      region
    });
  }
}
