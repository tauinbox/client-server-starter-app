import type {
  BillingProviderId,
  InvoiceKind,
  SubscriptionStatus
} from '@app/shared/types';
import type { Customer } from '../entities/customer.entity';
import type { Plan } from '../entities/plan.entity';

/**
 * Provider-agnostic event shape a `PaymentProvider` produces from a verified
 * webhook. The core reduces it onto `Subscription`/`Invoice`; `payload`
 * carries the original provider object the reducer needs.
 */
export type NormalizedEventType =
  | 'subscription.activated'
  | 'subscription.renewed'
  | 'subscription.past_due'
  | 'subscription.canceled'
  | 'subscription.plan_changed'
  | 'invoice.paid'
  | 'payment.failed'
  | 'payment_method.updated';

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
  /**
   * The `usage:{subscriptionId}:{periodEnd}` key a postpaid usage charge was
   * posted under (echoed back through the provider's price custom data). When
   * present, the reducer reconciles the payment onto the matching pending
   * usage invoice instead of inserting a new row.
   */
  usageChargeKey?: string | null;
  /**
   * `'one_time'` for a standalone purchase — the provider echoes
   * the marker planted by `createOneTimePayment`, and the reducer writes an
   * `Invoice` with no subscription and applies the product's grant instead of
   * activating anything. Absent/`'subscription'` for recurring invoices.
   */
  kind?: InvoiceKind;
  /** The purchased `Product` id echoed back on a one-time payment. */
  productId?: string | null;
}

/**
 * Carried by a `payment_method.updated` normalized event: the card a
 * self-managed (YooKassa) zero-amount re-bind saved. The reducer replaces the
 * customer's default `PaymentMethod` with it — no money moved, no invoice.
 */
export interface NormalizedPaymentMethodPayload {
  ref: NormalizedCustomerRef;
  savedPaymentMethod: NormalizedSavedPaymentMethod | null;
}

/** Failure context carried by a `payment.failed` normalized event. */
export interface NormalizedPaymentFailedPayload {
  ref: NormalizedCustomerRef;
  providerSubscriptionId: string | null;
  /** See `NormalizedInvoicePayload.usageChargeKey` — marks the pending usage invoice failed. */
  usageChargeKey?: string | null;
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

/**
 * A standalone one-time purchase. `productId` is echoed through
 * the provider's custom data/metadata so the paid webhook reduces onto an
 * `Invoice` with the product reference; `paddlePriceId` selects the Paddle
 * catalog price for fixed-price products — absent for `custom` amounts, which
 * are charged via an inline (non-catalog) price.
 */
export interface OneTimePaymentParams {
  amountMinor: number;
  currency: string;
  description: string;
  receiptItems: ReceiptItem[];
  productId: string;
  urls: CheckoutUrls;
  paddlePriceId?: string;
}

/**
 * Where the buyer completes a one-time payment: YooKassa always returns a
 * confirmation `url`; Paddle may complete client-side via Paddle.js with the
 * transaction id (`sessionRef`), so `url` is optional.
 */
export interface OneTimePaymentSession {
  url?: string;
  sessionRef: string;
}

export interface ChargeResult {
  providerInvoiceRef: string;
}

/** Net immediate cost of a delegated plan change, from the provider's preview. */
export interface ChangePreview {
  amountMinor: number;
  currency: string;
}

/**
 * Payment provider behind the `BILLING_PROVIDERS` token. Paddle manages the
 * subscription lifecycle itself (`managesLifecycle = true`); YooKassa is
 * self-managed (`false`) so the core drives renewals. `verifyAndParseWebhook`
 * returns `null` for a payload that cannot be verified, so the
 * webhook-ingestion seam stays exercisable without provider credentials.
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
  /**
   * Starts a standalone one-time payment — no subscription, no
   * saved payment method. Paddle: `transactions.create` with the catalog
   * `paddlePriceId` or an inline price; YooKassa: `createPayment` with a 54-FZ
   * receipt and a redirect confirmation. The one-time marker and `productId`
   * round-trip through custom data so the paid webhook reduces onto a
   * `kind 'one_time'` invoice and applies the product's grant.
   */
  createOneTimePayment(
    customer: Customer,
    params: OneTimePaymentParams
  ): Promise<OneTimePaymentSession>;
  /**
   * Posts a postpaid usage charge against a provider-managed subscription at
   * its billing-cycle boundary (Paddle `createOneTimeCharge`). `chargeKey` is
   * echoed back through the provider's price custom data so the resulting paid
   * webhook reconciles onto the pending usage invoice. Self-managed providers
   * charge usage through the renewal scheduler and reject this call.
   */
  chargeUsage(
    providerSubscriptionId: string,
    amountMinor: number,
    currency: string,
    description: string,
    chargeKey: string
  ): Promise<void>;
  /**
   * Switches a provider-managed subscription to `plan` with immediate
   * proration (Paddle `subscriptions.update`, `prorated_immediately`). The
   * provider computes the credit/charge and emits the usual webhooks; the
   * `customer` identifiers are re-planted in custom data so they — and the new
   * plan key — survive the update for the webhook reducer. Self-managed
   * providers reject this call: their proration is computed by the core
   * (`ProrationCalculator`) and settled via refund + chargeOffSession.
   */
  changePlan(
    providerSubscriptionId: string,
    customer: Customer,
    plan: Plan
  ): Promise<void>;
  /** Previews `changePlan` without applying it (net immediate amount). */
  previewChangePlan(
    providerSubscriptionId: string,
    plan: Plan
  ): Promise<ChangePreview>;
  /**
   * Starts the flow that replaces the payment instrument behind the
   * subscription. Paddle returns its hosted payment-method-change
   * checkout for the provider-side subscription (`providerSubscriptionId`
   * required); YooKassa creates a zero-amount card re-bind whose success
   * webhook (`payment_method.updated`) swaps the default saved method.
   */
  updatePaymentMethod(
    providerSubscriptionId: string | null,
    customer: Customer,
    urls: CheckoutUrls
  ): Promise<CheckoutSession>;
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
