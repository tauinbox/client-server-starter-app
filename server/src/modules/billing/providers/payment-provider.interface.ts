import type { BillingProviderId } from '@app/shared/types';
import type { Customer } from '../entities/customer.entity';
import type { Plan } from '../entities/plan.entity';

/**
 * Provider-agnostic event shape a `PaymentProvider` produces from a verified
 * webhook. The core reduces it onto `Subscription`/`Invoice` (M1+); `payload`
 * carries the original provider object the reducer needs.
 */
export type NormalizedEventType =
  | 'subscription.activated'
  | 'subscription.renewed'
  | 'subscription.past_due'
  | 'subscription.canceled'
  | 'subscription.plan_changed'
  | 'invoice.paid'
  | 'payment.failed';

export interface NormalizedEvent {
  provider: BillingProviderId;
  providerEventId: string;
  type: NormalizedEventType;
  payload: unknown;
}

export type CancelMode = 'period_end' | 'immediate';

export interface CheckoutUrls {
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  url: string;
  sessionRef: string;
}

/** A single line on a charge/receipt (54-FZ requires itemised receipts). */
export interface ReceiptItem {
  description: string;
  amountMinor: number;
  quantity: number;
}

export interface ChargeResult {
  providerInvoiceRef: string;
}

/**
 * Payment provider behind the `BILLING_PROVIDERS` token. Paddle manages the
 * subscription lifecycle itself (`managesLifecycle = true`); YooKassa is
 * self-managed (`false`) so the core drives renewals. Real implementations land
 * in M1 — the M0 stubs throw `NotImplemented`, except `verifyAndParseWebhook`
 * which returns `null` so the webhook-ingestion seam (M0.5) is exercisable.
 */
export interface PaymentProvider {
  readonly id: BillingProviderId;
  readonly managesLifecycle: boolean;
  ensureCustomer(customer: Customer): Promise<string>;
  startCheckout(
    customer: Customer,
    plan: Plan,
    urls: CheckoutUrls
  ): Promise<CheckoutSession>;
  chargeOffSession(
    customer: Customer,
    amountMinor: number,
    receiptItems: ReceiptItem[]
  ): Promise<ChargeResult>;
  cancel(providerSubscriptionId: string, mode: CancelMode): Promise<void>;
  refund(providerInvoiceRef: string, amountMinor: number): Promise<void>;
  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<NormalizedEvent | null>;
}

/** Injection token for the registered `PaymentProvider` array. */
export const BILLING_PROVIDERS = Symbol('BILLING_PROVIDERS');
