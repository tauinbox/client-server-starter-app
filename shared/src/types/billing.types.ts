export type BillingProviderId = 'paddle' | 'yookassa';

export type PlanInterval = 'month' | 'year';

export type BillingMode = 'fixed' | 'usage';

export type SubscriptionStatus =
  | 'incomplete'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

/**
 * Distinguishes recurring subscription invoices from standalone one-time
 * purchases (SKU / custom amount). One-time invoices have `subscriptionId`
 * null and reference the purchased product via `productId`.
 */
export type InvoiceKind = 'subscription' | 'one_time';

/** Catalog entry kind: fixed-price SKU, credit pack, or custom amount. */
export type ProductType = 'sku' | 'credits' | 'custom';

/**
 * Region selector for the manual billing-region override. `auto` clears the
 * override (geo decides); `ru` pins YooKassa; `world` pins Paddle.
 */
export type BillingRegion = 'auto' | 'ru' | 'world';

/**
 * One provider's price for a plan. Two prices per tier (RUB via YooKassa, USD
 * via Paddle) live keyed by provider — the resolved provider selects which is
 * charged/shown. `unitPriceMinor`/`includedUnits` apply to usage plans only.
 * `providerPriceId` is the provider's catalog price identifier (Paddle requires
 * a catalog `priceId` to open a subscription checkout); YooKassa charges by
 * amount and leaves it unset.
 */
export type PlanPrice = {
  currency: string;
  amountMinor: number;
  unitPriceMinor?: number;
  includedUnits?: number;
  providerPriceId?: string;
};

/**
 * One provider's price for a one-time product, keyed by provider like
 * `PlanPrice`. Fixed-price products (`sku`/`credits`) set `amountMinor`
 * (server-authoritative) and, for Paddle, the catalog `paddlePriceId`.
 * `custom` products set the allowed `minAmountMinor`/`maxAmountMinor` bounds
 * instead — the buyer picks the amount within them.
 */
export type ProductPrice = {
  currency: string;
  amountMinor?: number;
  paddlePriceId?: string;
  minAmountMinor?: number;
  maxAmountMinor?: number;
};

/**
 * What a paid one-time purchase grants: `credits` tops up the prepaid credit
 * balance (credit packs); `entitlement` unlocks a capability via a
 * `CustomerGrant`, permanent unless `durationDays` is set. `custom` products
 * carry no grant (donation / pay-by-invoice).
 */
export type ProductGrant = {
  credits?: number;
  entitlement?: string;
  durationDays?: number;
};

export type ProductResponse = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  type: ProductType;
  prices: Partial<Record<BillingProviderId, ProductPrice>>;
  grant: ProductGrant | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * An entitlement unlocked by a paid one-time SKU purchase. Active while
 * neither expired nor revoked; unioned into the customer's capabilities by
 * EntitlementService.
 */
export type CustomerGrantResponse = {
  id: string;
  customerId: string;
  entitlement: string;
  sourceInvoiceId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type PlanResponse = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  billingMode: BillingMode;
  interval: PlanInterval;
  meterKey: string | null;
  entitlements: string[];
  limits: Record<string, number> | null;
  trialDays: number;
  active: boolean;
  prices: Partial<Record<BillingProviderId, PlanPrice>>;
  createdAt: string;
  updatedAt: string;
};

export type CustomerResponse = {
  id: string;
  userId: string;
  provider: BillingProviderId;
  providerOverride: BillingProviderId | null;
  country: string;
  currency: string;
  defaultPaymentMethodId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentMethodResponse = {
  id: string;
  customerId: string;
  provider: BillingProviderId;
  brand: string;
  last4: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionResponse = {
  id: string;
  customerId: string;
  planKey: string;
  provider: BillingProviderId;
  billingMode: BillingMode;
  status: SubscriptionStatus;
  lifecycleOwner: 'provider' | 'self';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
  paymentMethodId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceResponse = {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  provider: BillingProviderId;
  providerInvoiceRef: string;
  amountMinor: number;
  currency: string;
  status: InvoiceStatus;
  billingMode: BillingMode;
  kind: InvoiceKind;
  productId: string | null;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
  receiptRef: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * A single metered-usage record on the wire. `idempotencyKey` is an internal
 * dedup token (`@Exclude`d server-side) and is intentionally absent.
 */
export type UsageResponse = {
  id: string;
  customerId: string;
  subscriptionId: string;
  meterKey: string;
  quantity: number;
  occurredAt: string;
  recordedAt: string;
};

/**
 * Result of `GET /billing/usage` — the caller's metered usage aggregated over
 * the current billing period of their usage-mode subscription (null when there
 * is no open usage subscription). `billableUnits` is the overage beyond the
 * plan's included units; `amountMinor` is what that overage costs at the
 * plan's unit price.
 */
export type UsageSummaryResponse = {
  subscriptionId: string;
  meterKey: string | null;
  periodStart: string;
  periodEnd: string;
  totalUnits: number;
  includedUnits: number;
  billableUnits: number;
  unitPriceMinor: number;
  amountMinor: number;
  currency: string;
};

/**
 * Result of `POST /billing/subscription/change/preview` — what an instant
 * prorated switch to `toPlanKey` would cost right now (design §17.4, §21.3).
 * For the self-managed provider (YooKassa) the server computes the split:
 * `creditMinor` is the refunded unused remainder of the current plan and
 * `chargeMinor` the new plan prorated to the period end. For the delegated
 * provider (Paddle) only the net is known — both split fields are `null`.
 * `dueNowMinor` is the net effect (`charge − credit`); negative = net refund.
 */
export type ProrationPreviewResponse = {
  provider: BillingProviderId;
  fromPlanKey: string;
  toPlanKey: string;
  currency: string;
  creditMinor: number | null;
  chargeMinor: number | null;
  dueNowMinor: number;
};

/**
 * Result of `POST /billing/checkout` — a hosted-checkout redirect. `sessionRef`
 * is the provider session reference echoed back on the return URL.
 */
export type CheckoutSessionResponse = {
  provider: BillingProviderId;
  url: string;
  sessionRef: string;
};

/**
 * Result of `POST /billing/purchase` — where the buyer completes a one-time
 * payment. YooKassa always returns a confirmation `url`; Paddle may complete
 * client-side via Paddle.js with the transaction id (`sessionRef`), so `url`
 * can be null.
 */
export type PurchaseSessionResponse = {
  provider: BillingProviderId;
  url: string | null;
  sessionRef: string;
};

/**
 * Result of `GET`/`PUT /billing/region` (design §19). `region` is the user's
 * current selection (`auto` = no override). `detectedProvider` is the geo
 * default; `effectiveProvider` is what the next checkout would actually use
 * (`providerOverride ?? geoDefault`).
 */
export type BillingRegionResponse = {
  region: BillingRegion;
  detectedProvider: BillingProviderId;
  effectiveProvider: BillingProviderId;
};
