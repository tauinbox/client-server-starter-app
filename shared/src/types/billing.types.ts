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
 * Result of `POST /billing/checkout` — a hosted-checkout redirect. `sessionRef`
 * is the provider session reference echoed back on the return URL.
 */
export type CheckoutSessionResponse = {
  provider: BillingProviderId;
  url: string;
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
