import type { BillingProviderId, SubscriptionStatus } from '@app/shared/types';
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

/**
 * Identifies the affected user/customer on a normalized event. Providers echo
 * our `customerId`/`userId` through their custom-data field at checkout so the
 * reducer resolves the local rows without a provider-id reverse lookup.
 */
export interface NormalizedCustomerRef {
  customerId?: string;
  userId?: string;
}

/**
 * Subscription state carried by a `subscription.*` normalized event. The reducer
 * upserts our `Subscription` row to match this snapshot (provider is the source
 * of truth for a `managesLifecycle` provider). Timestamps are ISO strings.
 */
export interface NormalizedSubscriptionPayload {
  ref: NormalizedCustomerRef;
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  planKey: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
}

/**
 * A card saved during a self-managed (YooKassa) first payment — the off-session
 * autopay reference the reducer persists as a `PaymentMethod`. Absent for
 * provider-managed (Paddle) invoices, where the provider holds the method.
 */
export interface NormalizedSavedPaymentMethod {
  providerMethodRef: string;
  brand: string;
  last4: string;
}

/** Invoice state carried by an `invoice.paid` normalized event. */
export interface NormalizedInvoicePayload {
  ref: NormalizedCustomerRef;
  providerInvoiceRef: string;
  providerSubscriptionId: string | null;
  amountMinor: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  /**
   * Present only on the self-managed first payment (`save_payment_method`): the
   * reducer stores it and activates the local subscription keyed by customer id.
   */
  savedPaymentMethod?: NormalizedSavedPaymentMethod | null;
}

/** Failure context carried by a `payment.failed` normalized event. */
export interface NormalizedPaymentFailedPayload {
  ref: NormalizedCustomerRef;
  providerSubscriptionId: string | null;
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
    receiptItems: ReceiptItem[],
    idempotencyKey?: string
  ): Promise<ChargeResult>;
  cancel(providerSubscriptionId: string, mode: CancelMode): Promise<void>;
  refund(
    providerInvoiceRef: string,
    amountMinor: number,
    idempotencyKey?: string
  ): Promise<void>;
  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<NormalizedEvent | null>;
}

/** Injection token for the registered `PaymentProvider` array. */
export const BILLING_PROVIDERS = Symbol('BILLING_PROVIDERS');
