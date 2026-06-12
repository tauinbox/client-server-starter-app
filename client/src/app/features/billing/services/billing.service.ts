import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  BillingRegion,
  BillingRegionResponse,
  CheckoutSessionResponse,
  CreditBalanceResponse,
  InvoiceResponse,
  PaymentMethodResponse,
  PlanResponse,
  ProductResponse,
  ProrationPreviewResponse,
  PurchaseSessionResponse,
  SubscriptionResponse,
  UsageSummaryResponse
} from '@app/shared/types';

export const BILLING_API_V1 = '/api/v1/billing';

export type CancelMode = 'period_end' | 'immediate';

/**
 * One-time purchase request. `amountMinor` is required for
 * custom-amount products and ignored for fixed-price ones (the server price
 * is authoritative); `description` is the optional buyer note on the receipt.
 */
export type PurchaseRequest = {
  productKey: string;
  amountMinor?: number;
  description?: string;
};

/**
 * Thin HTTP wrapper over the user billing API. Read endpoints
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

  getProducts(): Observable<ProductResponse[]> {
    return this.#http.get<ProductResponse[]>(`${BILLING_API_V1}/products`);
  }

  /** The caller's prepaid credit balance; null when no pack was ever bought. */
  getCredits(): Observable<CreditBalanceResponse | null> {
    return this.#http.get<CreditBalanceResponse | null>(
      `${BILLING_API_V1}/credits`
    );
  }

  purchase(request: PurchaseRequest): Observable<PurchaseSessionResponse> {
    return this.#http.post<PurchaseSessionResponse>(
      `${BILLING_API_V1}/purchase`,
      request
    );
  }

  checkout(planKey: string): Observable<CheckoutSessionResponse> {
    return this.#http.post<CheckoutSessionResponse>(
      `${BILLING_API_V1}/checkout`,
      { planKey }
    );
  }

  changePlan(planKey: string): Observable<SubscriptionResponse> {
    return this.#http.post<SubscriptionResponse>(
      `${BILLING_API_V1}/subscription/change`,
      { planKey }
    );
  }

  previewChange(planKey: string): Observable<ProrationPreviewResponse> {
    return this.#http.post<ProrationPreviewResponse>(
      `${BILLING_API_V1}/subscription/change/preview`,
      { planKey }
    );
  }

  /** Starts the provider-hosted payment-method update flow (redirect session). */
  updatePaymentMethod(): Observable<CheckoutSessionResponse> {
    return this.#http.post<CheckoutSessionResponse>(
      `${BILLING_API_V1}/payment-method`,
      {}
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
