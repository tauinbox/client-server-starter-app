import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import type {
  BillingProviderId,
  BillingRegion,
  BillingRegionResponse,
  CancelMode,
  EntitlementLimitKey,
  EntitlementsResponse,
  PlanResponse,
  ProrationPreviewResponse,
  UsageSummaryResponse
} from '@app/shared/types';
import {
  geoDefault,
  geoFromLocale,
  meteredWindowStart,
  overrideForRegion,
  prorationAmounts,
  rateUsage,
  regionForOverride,
  renewalAnchor,
  usageIngestStart
} from '@app/shared/utils/billing-rules';
import {
  BILLING_PROVIDER_FLAGS,
  CANCEL_MODES,
  CHANGEABLE_SUBSCRIPTION_STATUSES,
  ENTITLED_SUBSCRIPTION_STATUSES,
  ErrorKeys,
  type ErrorKey,
  INVOICE_LIST_QUERY,
  OPEN_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_LIST_QUERY,
  USAGE_FUTURE_TOLERANCE_MS
} from '@app/shared/constants';
import {
  getState,
  logAudit,
  toCreditBalanceResponse,
  toInvoiceResponse,
  toPaymentMethodResponse,
  toPlanResponse,
  toProductResponse,
  toSubscriptionResponse,
  toUsageResponse
} from '../state';
import { authGuard, permissionGuard } from '../helpers/auth.helpers';
import {
  billClosingUsagePeriod,
  sumPlanMeterUnits
} from '../helpers/billing.helpers';
import { notifyEntitlementsChanged } from '../helpers/billing-settle.helpers';
import { mockCheckoutUrl } from '../routes/mock-checkout';
import {
  listPage,
  listQueryErrors,
  rejectInvalidCursor
} from '../helpers/list-query.helpers';
import { addInterval } from '../utils/period';
import type {
  AuthenticatedRequest,
  MockCustomer,
  MockInvoice,
  MockPaymentMethod,
  MockPlan,
  MockSubscription,
  MockUsageRecord,
  MockUser
} from '../types';
import { isFlagEnabledForUser } from './feature-flags.middleware';
import {
  requireUuid,
  sendValidationError,
  type ValidationLocation
} from '../helpers/validation-error.helpers';
import { sendError } from '../helpers/error-envelope.helpers';
import {
  intErrors,
  iso8601Errors,
  oneOfErrors,
  trimmedStringErrors,
  unknownPropertyErrors,
  uuidErrors
} from '../utils/validation';

const router = Router();

const CANCEL_KEYS = ['mode'] as const;

/**
 * Replies with the class-validator envelope and returns true when anything
 * failed. Each handler states the keys of its own request DTO and collects the
 * messages in the order the server reports them: unknown properties first
 * (the pipe whitelists before it validates), then each property as declared.
 */
function rejectInvalid(
  res: Response,
  errors: string[],
  location: ValidationLocation = 'body'
): boolean {
  if (errors.length === 0) return false;
  sendValidationError(res, location, errors);
  return true;
}

/** Checkout and plan change share a single-`planKey` DTO with the same bounds. */
function planKeyBodyErrors(body: unknown): string[] {
  const fields = body as Record<string, unknown> | undefined;
  return [
    ...unknownPropertyErrors(body, ['planKey']),
    ...trimmedStringErrors('planKey', fields?.['planKey'], { min: 1, max: 100 })
  ];
}

/** Both cancel routes take the same optional `mode` DTO. */
function cancelBodyErrors(body: unknown): string[] {
  const fields = body as Record<string, unknown> | undefined;
  return [
    ...unknownPropertyErrors(body, CANCEL_KEYS),
    ...oneOfErrors('mode', fields?.['mode'], CANCEL_MODES, 'definedOnly')
  ];
}

// The mock has no provider secret and no provider API, so it mirrors only the
// checks that the server runs before it calls the provider.
function refuseWebhook(res: Response, message: string): void {
  // eslint-disable-next-line no-restricted-syntax -- the caller is a payment provider, not a user
  res.status(400).json({ message, statusCode: 400 });
}

function handleWebhook(
  isConfirmable: (req: Request) => boolean
): (req: Request, res: Response) => void {
  return (req, res) => {
    if (!req.body || Object.keys(req.body).length === 0) {
      refuseWebhook(res, 'Missing webhook body');
      return;
    }
    if (!isConfirmable(req)) {
      refuseWebhook(res, 'Webhook verification failed');
      return;
    }
    res.status(200).json({ received: true });
  };
}

// Mirrors PaddleProvider.verifyAndParseWebhook before the HMAC check.
router.post(
  '/paddle',
  handleWebhook((req) => Boolean(req.headers['paddle-signature']))
);

// Mirrors YooKassaProvider.verifyAndParseWebhook before the payment re-fetch.
router.post(
  '/yookassa',
  handleWebhook((req) => {
    const body = req.body as {
      event?: unknown;
      object?: { id?: unknown };
    };
    return (
      (body.event === 'payment.succeeded' ||
        body.event === 'payment.canceled') &&
      typeof body.object?.id === 'string' &&
      body.object.id !== ''
    );
  })
);

const billingRouter = Router();

// ---------------------------------------------------------------------------
// Public plan catalog. Mirrors the server's @Public() GET /billing/plans:
// active plans only, oldest first (seed order), each carrying the per-provider
// prices map. No auth.
// ---------------------------------------------------------------------------
billingRouter.get('/plans', (_req: Request, res: Response) => {
  const plans: PlanResponse[] = [];
  for (const plan of getState().plans.values()) {
    if (plan.active) plans.push(toPlanResponse(plan));
  }
  plans.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json(plans);
});

// Public Paddle.js configuration. Mirrors the server's @Public()
// GET /billing/paddle-config. No auth.
billingRouter.get('/paddle-config', (_req: Request, res: Response) => {
  res.json(getState().paddleClientConfig);
});

// Mock treats both providers as configured, so lifecycle
// ownership is purely the provider's: YooKassa self-managed, Paddle managed.
function managesLifecycle(provider: BillingProviderId): boolean {
  return provider !== 'yookassa';
}

// Mirrors BillingService.isProviderAvailable. Every provider is configured and
// registered here, so only the admin kill-switch flag, evaluated in full for
// the user, decides.
function isProviderAvailable(
  provider: BillingProviderId,
  user: MockUser
): boolean {
  const flagKey = BILLING_PROVIDER_FLAGS.find(
    (p) => p.provider === provider
  )?.enabledFlagKey;
  return flagKey !== undefined && isFlagEnabledForUser(user, flagKey);
}

// Mirrors the 503 of BillingService.resolveProvider at checkout and purchase.
function rejectUnavailableProvider(
  res: Response,
  provider: BillingProviderId,
  user: MockUser
): boolean {
  if (isProviderAvailable(provider, user)) return false;
  sendError(
    res,
    ErrorKeys.BILLING.PROVIDER_UNAVAILABLE,
    `Billing provider "${provider}" is not available`
  );
  return true;
}

// Mirrors PaddleProvider at checkout, plan change and its preview: Paddle
// bills a plan only through its catalog price id.
function rejectMissingPaddlePrice(
  res: Response,
  provider: BillingProviderId,
  plan: MockPlan
): boolean {
  if (provider !== 'paddle' || plan.prices.paddle?.providerPriceId) {
    return false;
  }
  sendError(
    res,
    ErrorKeys.BILLING.PLAN_NOT_CONFIGURED,
    `Plan "${plan.key}" has no Paddle price configured`
  );
  return true;
}

function effectiveProvider(
  customer: Pick<MockCustomer, 'providerOverride' | 'country'>
): BillingProviderId {
  return customer.providerOverride ?? geoDefault(customer.country);
}

// Mirrors BillingUserService.regionView: the body of GET and PUT /region.
function regionView(
  user: MockUser,
  customer: Pick<MockCustomer, 'providerOverride' | 'country'>
): BillingRegionResponse {
  return {
    region: regionForOverride(customer.providerOverride),
    detectedProvider: geoDefault(customer.country),
    effectiveProvider: effectiveProvider(customer),
    availableProviders: BILLING_PROVIDER_FLAGS.map(
      ({ provider }) => provider
    ).filter((provider) => isProviderAvailable(provider, user))
  };
}

function findCustomer(userId: string): MockCustomer | undefined {
  for (const customer of getState().billingCustomers.values()) {
    if (customer.userId === userId) return customer;
  }
  return undefined;
}

/** Plan key of the default (no-subscription) tier - mirrors FREE_PLAN_KEY. */
const FREE_PLAN_KEY = 'free';

function findPlanByKey(key: string): MockPlan | undefined {
  for (const plan of getState().plans.values()) {
    if (plan.key === key) return plan;
  }
  return undefined;
}

function toResolvedEntitlements(plan: MockPlan): EntitlementsResponse {
  return {
    planKey: plan.key,
    capabilities: plan.entitlements,
    limits: plan.limits ?? {}
  };
}

/**
 * Mirrors the server's EntitlementService.capabilitiesFor: the entitled
 * subscription's plan (or the Free tier when there is none), unioned with the
 * customer's active - non-revoked, non-expired - one-time purchase grants.
 * Deriving this from the plan catalog on the client would get all four rules
 * wrong, which is why the endpoint exists.
 */
function resolveEntitlements(userId: string): EntitlementsResponse {
  const customer = findCustomer(userId);
  const freePlan = findPlanByKey(FREE_PLAN_KEY);
  const free: EntitlementsResponse = freePlan
    ? toResolvedEntitlements(freePlan)
    : { planKey: FREE_PLAN_KEY, capabilities: [], limits: {} };

  if (!customer) return free;

  const subscription = [...getState().billingSubscriptions.values()]
    .filter(
      (s) =>
        s.customerId === customer.id &&
        ENTITLED_SUBSCRIPTION_STATUSES.includes(s.status)
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const plan = subscription ? findPlanByKey(subscription.planKey) : undefined;
  const base = plan ? toResolvedEntitlements(plan) : free;

  const now = Date.now();
  const granted = [...getState().billingCustomerGrants.values()]
    .filter(
      (grant) =>
        grant.customerId === customer.id &&
        !grant.revokedAt &&
        (!grant.expiresAt || Date.parse(grant.expiresAt) > now)
    )
    .map((grant) => grant.entitlement);
  if (granted.length === 0) return base;

  return {
    ...base,
    capabilities: [...new Set([...base.capabilities, ...granted])]
  };
}

/**
 * Mirrors the server's EntitlementService.limitFor: the numeric allowance the
 * plan in force carries under `key`, or null when it carries none and the
 * caller must apply its own default.
 */
export function resolveEntitlementLimit(
  userId: string,
  key: EntitlementLimitKey
): number | null {
  return resolveEntitlements(userId).limits[key] ?? null;
}

/**
 * Mirrors the server's billing user-deleted listener: a deleted user's
 * subscriptions are canceled so nothing keeps renewing or charging. The mock
 * "provider" is internal, so provider-managed rows settle to the same terminal
 * state immediately instead of waiting for a webhook.
 */
export function cancelSubscriptionsForDeletedUser(userId: string): void {
  const customer = findCustomer(userId);
  if (!customer) return;
  for (const sub of getState().billingSubscriptions.values()) {
    if (sub.customerId !== customer.id || sub.status === 'canceled') continue;
    sub.status = 'canceled';
    sub.cancelAtPeriodEnd = false;
    sub.updatedAt = new Date().toISOString();
  }
}

function getOrCreateCustomer(userId: string, locale: string): MockCustomer {
  const existing = findCustomer(userId);
  if (existing) return existing;
  const { country, currency } = geoFromLocale(locale);
  const now = new Date().toISOString();
  const customer: MockCustomer = {
    id: randomUUID(),
    userId,
    provider: geoDefault(country),
    providerOverride: null,
    country,
    currency,
    defaultPaymentMethodId: null,
    trialUsedAt: null,
    createdAt: now,
    updatedAt: now
  };
  getState().billingCustomers.set(customer.id, customer);
  return customer;
}

/**
 * Mirrors the server's whitelisted `ORDER BY` for the billing lists
 * (`list-order.util.ts`): an unrecognized `sortBy` falls back to `createdAt`.
 * Nulls sort last on an ascending pass, as Postgres orders them.
 */
function findCurrentSubscription(
  customerId: string
): MockSubscription | undefined {
  const subs = [...getState().billingSubscriptions.values()]
    .filter(
      (s) =>
        s.customerId === customerId &&
        OPEN_SUBSCRIPTION_STATUSES.includes(s.status)
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return subs[0];
}

// GET /billing/subscription — current subscription or null.
billingRouter.get('/subscription', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  const sub = customer ? findCurrentSubscription(customer.id) : undefined;
  res.json(sub ? toSubscriptionResponse(sub) : null);
});

// GET /billing/invoices — caller's invoices, newest first (paginated).
billingRouter.get('/invoices', authGuard, (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const errors = listQueryErrors(query, INVOICE_LIST_QUERY);
  if (rejectInvalid(res, errors, 'query')) return;
  if (rejectInvalidCursor(res, query)) return;

  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  const invoices = customer
    ? [...getState().billingInvoices.values()].filter(
        (i) => i.customerId === customer.id
      )
    : [];
  const page = listPage(invoices, INVOICE_LIST_QUERY, query);
  res.json({ data: page.data.map(toInvoiceResponse), meta: page.meta });
});

// GET /billing/payment-method — caller's default saved method or null.
billingRouter.get(
  '/payment-method',
  authGuard,
  (req: Request, res: Response) => {
    const { user } = req as AuthenticatedRequest;
    const customer = findCustomer(user.id);
    const method = customer?.defaultPaymentMethodId
      ? getState().billingPaymentMethods.get(customer.defaultPaymentMethodId)
      : undefined;
    res.json(method ? toPaymentMethodResponse(method) : null);
  }
);

// GET /billing/usage — metered usage aggregated over the current billing
// period of the caller's usage-mode subscription, or null. Mirrors the
// server's UsageRating math: records with occurredAt in [periodStart,
// periodEnd), overage beyond includedUnits charged at unitPriceMinor.
billingRouter.get('/usage', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  const sub = customer ? findCurrentSubscription(customer.id) : undefined;
  if (!sub || sub.billingMode !== 'usage') {
    res.json(null);
    return;
  }
  const plan = findPlanByKey(sub.planKey);
  const price = plan?.prices[sub.provider];
  if (!plan || !price) {
    res.json(null);
    return;
  }

  const windowStart = meteredWindowStart(sub);
  const totalUnits = sumPlanMeterUnits(
    plan,
    sub.id,
    windowStart,
    sub.currentPeriodEnd
  );

  const rated = rateUsage({ totalUnits, price });
  const summary: UsageSummaryResponse = {
    subscriptionId: sub.id,
    meterKey: plan.meterKey,
    periodStart: windowStart,
    periodEnd: sub.currentPeriodEnd,
    totalUnits,
    includedUnits: rated.includedUnits,
    billableUnits: rated.billableUnits,
    unitPriceMinor: rated.unitPriceMinor,
    amountMinor: rated.amountMinor,
    currency: price.currency
  };
  res.json(summary);
});

// POST /billing/payment-method — start the payment-method update flow for the
// current subscription. The server returns a hosted provider session and swaps
// the default method only when the provider's success webhook lands; the mock
// has no provider, so the swap happens synchronously here (same documented
// timing divergence as the plan-change settlement) and the session shape is
// still returned. The replacement card is deterministic for E2E assertions.
billingRouter.post(
  '/payment-method',
  authGuard,
  (req: Request, res: Response) => {
    const { user } = req as AuthenticatedRequest;
    const customer = findCustomer(user.id);
    const sub = customer ? findCurrentSubscription(customer.id) : undefined;
    if (!customer || !sub) {
      sendError(
        res,
        ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION,
        'No active subscription to update the payment method for'
      );
      return;
    }
    // The server re-binds in the currency of the price of the current plan.
    if (!findPlanByKey(sub.planKey)?.prices[sub.provider]) {
      sendError(
        res,
        ErrorKeys.BILLING.CURRENT_PLAN_MISSING,
        'The current plan is missing from the catalog'
      );
      return;
    }

    const state = getState();
    const nowIso = new Date().toISOString();
    for (const method of state.billingPaymentMethods.values()) {
      if (method.customerId === customer.id && method.isDefault) {
        method.isDefault = false;
        method.updatedAt = nowIso;
      }
    }
    const replacement: MockPaymentMethod = {
      id: randomUUID(),
      customerId: customer.id,
      provider: sub.provider,
      providerMethodRef: `pm_${randomUUID()}`,
      brand: 'mastercard',
      last4: '4444',
      isDefault: true,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    state.billingPaymentMethods.set(replacement.id, replacement);
    customer.defaultPaymentMethodId = replacement.id;
    customer.updatedAt = nowIso;
    sub.paymentMethodId = replacement.id;
    sub.updatedAt = nowIso;

    const sessionRef = randomUUID();
    state.billingCheckoutSessions.set(sessionRef, {
      sessionRef,
      customerId: customer.id,
      provider: sub.provider,
      kind: 'method',
      createdAt: nowIso
    });
    res.json({
      provider: sub.provider,
      url: mockCheckoutUrl(sessionRef),
      sessionRef
    });
  }
);

// GET /billing/products — one-time purchase catalog: active products carrying
// a price entry for the caller's effective provider (sku/credits fixed prices
// plus custom amount bounds), oldest first. Like /region this is a read — no
// availability assertion, the catalog stays browsable.
billingRouter.get('/products', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  const provider = customer
    ? effectiveProvider(customer)
    : geoDefault(geoFromLocale(user.locale).country);

  const products = [...getState().billingProducts.values()]
    .filter((product) => product.active && product.prices[provider])
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toProductResponse);
  res.json(products);
});

// GET /billing/entitlements — advisory read for the client mirror; the
// entitlement guard stays the enforcement point.
billingRouter.get('/entitlements', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  res.json(resolveEntitlements(user.id));
});

// GET /billing/credits — caller's prepaid credit balance, or null when no
// credit pack was ever bought (the client renders that as zero).
billingRouter.get('/credits', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  const balance = customer
    ? getState().billingCreditBalances.get(customer.id)
    : undefined;
  res.json(balance ? toCreditBalanceResponse(balance) : null);
});

// POST /billing/purchase — start a one-time purchase. Mirrors the server's
// validation chain: unknown/inactive product 404, no price for the resolved
// provider 409, misconfigured catalog 503 (also a Paddle sku/credits price with
// no `paddlePriceId`), custom amount required and bounded 400. The provider session is recorded as a pending purchase that
// /__control/billing/complete-purchase settles the way the paid webhook would.
billingRouter.post('/purchase', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const body = req.body as Record<string, unknown> | undefined;
  if (
    rejectInvalid(res, [
      ...unknownPropertyErrors(body, [
        'productKey',
        'amountMinor',
        'description'
      ]),
      ...trimmedStringErrors('productKey', body?.['productKey'], {
        min: 1,
        max: 100
      }),
      ...intErrors('amountMinor', body?.['amountMinor'], {
        min: 1,
        optional: 'definedOnly'
      }),
      ...trimmedStringErrors('description', body?.['description'], {
        max: 128,
        optional: 'nullable'
      })
    ])
  ) {
    return;
  }
  const productKey = (body?.['productKey'] as string).trim();
  const requestedMinor = body?.['amountMinor'] as number | undefined;

  const product = [...getState().billingProducts.values()].find(
    (p) => p.key === productKey
  );
  if (!product || !product.active) {
    sendError(
      res,
      ErrorKeys.BILLING.PRODUCT_NOT_FOUND,
      `Product "${productKey}" was not found`
    );
    return;
  }

  const customer = getOrCreateCustomer(user.id, user.locale);
  const provider = effectiveProvider(customer);
  if (rejectUnavailableProvider(res, provider, user)) return;
  const price = product.prices[provider];
  if (!price) {
    sendError(
      res,
      ErrorKeys.BILLING.PRODUCT_UNAVAILABLE_FOR_PROVIDER,
      `Product "${product.key}" is not available for your billing provider.`
    );
    return;
  }

  // Amount resolution mirrors the server's threat model: fixed-price products
  // charge the catalog price (client amount ignored); custom requires a
  // client amount inside the configured bounds.
  let amountMinor: number;
  if (product.type !== 'custom') {
    if (!price.amountMinor || price.amountMinor <= 0) {
      sendError(
        res,
        ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED,
        `Product "${product.key}" has no price configured`
      );
      return;
    }
    amountMinor = price.amountMinor;
  } else {
    const { minAmountMinor, maxAmountMinor } = price;
    // `== null`, not falsy: a configured lower bound of 0 (any amount the
    // request already has to be >= 1 for) is legitimate, not "unconfigured".
    if (minAmountMinor == null || maxAmountMinor == null) {
      sendError(
        res,
        ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED,
        `Product "${product.key}" has no amount bounds configured`
      );
      return;
    }
    if (requestedMinor === undefined) {
      sendError(
        res,
        ErrorKeys.BILLING.AMOUNT_REQUIRED,
        'amountMinor is required for a custom-amount product'
      );
      return;
    }
    if (requestedMinor < minAmountMinor || requestedMinor > maxAmountMinor) {
      sendError(
        res,
        ErrorKeys.BILLING.AMOUNT_OUT_OF_RANGE,
        `amountMinor must be between ${minAmountMinor} and ${maxAmountMinor}`
      );
      return;
    }
    amountMinor = requestedMinor;
  }
  // The Paddle webhook grants the product it finds by the paid catalog price
  // id, so a fixed-price Paddle purchase needs one.
  if (
    provider === 'paddle' &&
    product.type !== 'custom' &&
    !price.paddlePriceId
  ) {
    sendError(
      res,
      ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED,
      `Product "${product.key}" has no Paddle price configured`
    );
    return;
  }

  const sessionRef = randomUUID();
  getState().billingPurchaseSessions.set(sessionRef, {
    sessionRef,
    customerId: customer.id,
    productId: product.id,
    provider,
    amountMinor,
    currency: price.currency,
    createdAt: new Date().toISOString()
  });
  res.json({
    provider,
    url: mockCheckoutUrl(sessionRef),
    sessionRef
  });
});

// POST /billing/checkout — start a hosted checkout for a plan.
billingRouter.post('/checkout', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  if (rejectInvalid(res, planKeyBodyErrors(req.body))) return;
  const planKey = (
    (req.body as Record<string, unknown>)['planKey'] as string
  ).trim();

  const plan = findPlanByKey(planKey);
  if (!plan?.active) {
    sendError(
      res,
      ErrorKeys.BILLING.PLAN_NOT_FOUND,
      `Plan "${planKey}" was not found`
    );
    return;
  }

  const customer = getOrCreateCustomer(user.id, user.locale);

  const hasActive = [...getState().billingSubscriptions.values()].some(
    (s) =>
      s.customerId === customer.id &&
      ENTITLED_SUBSCRIPTION_STATUSES.includes(s.status)
  );
  if (hasActive) {
    sendError(
      res,
      ErrorKeys.BILLING.ALREADY_SUBSCRIBED,
      'You already have an active subscription. Cancel it before subscribing to another plan.'
    );
    return;
  }

  const provider = effectiveProvider(customer);
  if (rejectUnavailableProvider(res, provider, user)) return;

  // A prior unpaid checkout leaves an `incomplete` row. Reuse it rather than
  // stack a second open subscription (the server enforces this with a partial
  // unique index; mirror the observable single-open-subscription behavior here).
  const pending = [...getState().billingSubscriptions.values()].find(
    (s) => s.customerId === customer.id && s.status === 'incomplete'
  );

  // One trial for each customer.
  const trial = plan.trialDays > 0 && !customer.trialUsedAt;

  if (!managesLifecycle(provider)) {
    const now = new Date();
    const fields = {
      planKey: plan.key,
      provider,
      billingMode: plan.billingMode,
      status: 'incomplete' as const,
      lifecycleOwner: 'self' as const,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: addInterval(now, plan.interval).toISOString(),
      billingAnchorAt: now.toISOString(),
      cancelAtPeriodEnd: false,
      trialEnd: trial
        ? new Date(now.getTime() + plan.trialDays * 86_400_000).toISOString()
        : null,
      paymentMethodId: null,
      providerSubscriptionId: null,
      updatedAt: now.toISOString()
    };
    if (pending) {
      Object.assign(pending, fields);
    } else {
      const sub: MockSubscription = {
        id: randomUUID(),
        customerId: customer.id,
        ...fields,
        createdAt: now.toISOString()
      };
      getState().billingSubscriptions.set(sub.id, sub);
    }
  } else if (pending) {
    // Region now resolves a provider-managed plan; release the stale self row.
    pending.status = 'canceled';
    pending.updatedAt = new Date().toISOString();
  }
  if (rejectMissingPaddlePrice(res, provider, plan)) return;

  const sessionRef = randomUUID();
  getState().billingCheckoutSessions.set(sessionRef, {
    sessionRef,
    customerId: customer.id,
    provider,
    kind: 'plan',
    planKey: plan.key,
    trial,
    createdAt: new Date().toISOString()
  });
  res.json({
    provider,
    url: mockCheckoutUrl(sessionRef),
    sessionRef
  });
});

// ---------------------------------------------------------------------------
// Plan change with proration. Mirrors the server's guards and uses its
// proration amounts (`prorationAmounts`, refund-and-recharge). The
// server's Paddle path delegates the money to Paddle and reconciles invoices
// via webhooks; the mock has no provider, so both providers settle the same
// synchronous way — the documented divergence is timing, not shape.
// ---------------------------------------------------------------------------
interface ChangeGuardResult {
  customer: MockCustomer;
  sub: MockSubscription;
  fromPlan: MockPlan;
  toPlan: MockPlan;
}

/** Shared guards of change/preview; replies with the error and returns null. */
function guardChange(req: Request, res: Response): ChangeGuardResult | null {
  const { user } = req as AuthenticatedRequest;
  if (rejectInvalid(res, planKeyBodyErrors(req.body))) return null;
  const planKey = (
    (req.body as Record<string, unknown>)['planKey'] as string
  ).trim();

  const customer = findCustomer(user.id);
  const sub = customer ? findCurrentSubscription(customer.id) : undefined;
  if (!customer || !sub) {
    sendError(
      res,
      ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION,
      'No active subscription to change'
    );
    return null;
  }
  if (!CHANGEABLE_SUBSCRIPTION_STATUSES.includes(sub.status)) {
    sendError(
      res,
      ErrorKeys.BILLING.SUBSCRIPTION_NOT_CHANGEABLE,
      'The subscription must be active to change plans. Settle any outstanding payment first.'
    );
    return null;
  }
  if (sub.cancelAtPeriodEnd) {
    sendError(
      res,
      ErrorKeys.BILLING.CANCELLATION_SCHEDULED,
      'A cancellation is scheduled for this subscription; it can no longer change plans.'
    );
    return null;
  }
  if (
    sub.lifecycleOwner === 'self' &&
    new Date(renewalAnchor(sub)).getTime() <= Date.now()
  ) {
    sendError(
      res,
      ErrorKeys.BILLING.RENEWAL_IN_PROGRESS,
      'The billing period has ended and its renewal is in progress. Try again shortly.'
    );
    return null;
  }

  const toPlan = findPlanByKey(planKey);
  if (!toPlan?.active) {
    sendError(
      res,
      ErrorKeys.BILLING.PLAN_NOT_FOUND,
      `Plan "${planKey}" was not found`
    );
    return null;
  }
  if (toPlan.key === sub.planKey) {
    sendError(
      res,
      ErrorKeys.BILLING.SAME_PLAN,
      'You are already on this plan.'
    );
    return null;
  }
  if (!toPlan.prices[sub.provider]) {
    sendError(
      res,
      ErrorKeys.BILLING.PLAN_UNAVAILABLE_FOR_PROVIDER,
      `Plan "${toPlan.key}" is not available for your billing provider.`
    );
    return null;
  }

  const fromPlan = findPlanByKey(sub.planKey);
  if (!fromPlan) {
    sendError(
      res,
      ErrorKeys.BILLING.CURRENT_PLAN_MISSING,
      'The current plan is missing from the catalog'
    );
    return null;
  }
  if (rejectMissingPaddlePrice(res, sub.provider, toPlan)) return null;

  return { customer, sub, fromPlan, toPlan };
}

/**
 * The refund leg of a self-managed switch: the latest paid fixed invoice, and
 * the quoted refund capped by what is still unrefunded on it. The preview and
 * the executed change both read it, so the credit shown is the credit paid.
 */
function prorationRefund(
  sub: MockSubscription,
  quotedMinor: number
): { source: MockInvoice | undefined; refundMinor: number } {
  const source = [...getState().billingInvoices.values()]
    .filter(
      (i) =>
        i.subscriptionId === sub.id &&
        i.status === 'paid' &&
        i.billingMode === 'fixed' &&
        i.amountMinor > 0
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const refundMinor = source
    ? Math.min(quotedMinor, source.amountMinor - (source.refundedMinor ?? 0))
    : 0;
  return { source, refundMinor };
}

// POST /billing/subscription/change — instant prorated plan/mode switch.
billingRouter.post(
  '/subscription/change',
  authGuard,
  (req: Request, res: Response) => {
    const ctx = guardChange(req, res);
    if (!ctx) return;
    const { customer, sub, fromPlan, toPlan } = ctx;
    const now = new Date();
    const nowIso = now.toISOString();
    const modeChanges = toPlan.billingMode !== sub.billingMode;

    // Units metered before the switch are billed under the outgoing plan. The
    // server charges a Paddle window after the switch; the mock settles now.
    if (modeChanges && sub.billingMode === 'usage') {
      billClosingUsagePeriod(sub, now);
    }

    // Trial moves no fixed money, and a provider-managed row is prorated by the
    // provider; a self-managed paid period settles the charge + refund legs.
    if (sub.status !== 'trialing' && !managesLifecycle(sub.provider)) {
      const quote = prorationAmounts({
        fromPlan,
        toPlan,
        provider: sub.provider,
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        now
      });
      const state = getState();

      // Resolved before the new charge is recorded so the charge can't become
      // its own refund source (the server has a provider call in between, so it
      // excludes its charge row by id instead).
      const { source, refundMinor } = prorationRefund(sub, quote.refundMinor);

      if (quote.chargeMinor > 0) {
        const charge: MockInvoice = {
          id: randomUUID(),
          customerId: customer.id,
          subscriptionId: sub.id,
          provider: sub.provider,
          providerInvoiceRef: `in_${randomUUID()}`,
          amountMinor: quote.chargeMinor,
          currency: quote.currency,
          status: 'paid',
          billingMode: toPlan.billingMode,
          kind: 'subscription',
          productId: null,
          periodStart: nowIso,
          periodEnd: sub.currentPeriodEnd,
          paidAt: nowIso,
          receiptRef: null,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        state.billingInvoices.set(charge.id, charge);
      }

      if (refundMinor > 0 && source) {
        const refund: MockInvoice = {
          id: randomUUID(),
          customerId: customer.id,
          subscriptionId: sub.id,
          provider: sub.provider,
          providerInvoiceRef: source.providerInvoiceRef,
          amountMinor: refundMinor,
          currency: quote.currency,
          status: 'refunded',
          billingMode: 'fixed',
          kind: 'subscription',
          productId: null,
          periodStart: nowIso,
          periodEnd: sub.currentPeriodEnd,
          paidAt: nowIso,
          receiptRef: null,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        state.billingInvoices.set(refund.id, refund);
        // Record the partial refund on the source so an admin refund of the same
        // invoice can't give the money back twice.
        source.refundedMinor = (source.refundedMinor ?? 0) + refundMinor;
        if (source.refundedMinor >= source.amountMinor) {
          source.status = 'refunded';
          source.updatedAt = nowIso;
        }
      }
    }

    sub.planKey = toPlan.key;
    sub.billingMode = toPlan.billingMode;
    if (modeChanges) sub.meteredFrom = nowIso;
    sub.updatedAt = nowIso;
    notifyEntitlementsChanged(customer.id);
    res.json(toSubscriptionResponse(sub));
  }
);

// POST /billing/subscription/change/preview — prorated cost without applying.
billingRouter.post(
  '/subscription/change/preview',
  authGuard,
  (req: Request, res: Response) => {
    const ctx = guardChange(req, res);
    if (!ctx) return;
    const { sub, fromPlan, toPlan } = ctx;
    const delegated = managesLifecycle(sub.provider);
    const quote = prorationAmounts({
      fromPlan,
      toPlan,
      provider: sub.provider,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      now: new Date()
    });
    const trial = sub.status === 'trialing';
    // The self-managed credit is capped as the executed refund caps it; the
    // delegated net stands in for the provider's own preview.
    const refundMinor = trial
      ? 0
      : delegated
        ? quote.refundMinor
        : prorationRefund(sub, quote.refundMinor).refundMinor;
    const chargeMinor = trial ? 0 : quote.chargeMinor;

    const preview: ProrationPreviewResponse = {
      provider: sub.provider,
      fromPlanKey: fromPlan.key,
      toPlanKey: toPlan.key,
      currency: quote.currency,
      creditMinor: delegated ? null : refundMinor,
      chargeMinor: delegated ? null : chargeMinor,
      dueNowMinor: chargeMinor - refundMinor
    };
    res.json(preview);
  }
);

/** Mirrors `cancelRefusal` of the server cancel tail. */
function cancelRefusal(
  sub: MockSubscription,
  mode: CancelMode
): { message: string; errorKey: ErrorKey } | null {
  if (!OPEN_SUBSCRIPTION_STATUSES.includes(sub.status)) {
    return {
      message: 'This subscription is already canceled.',
      errorKey: ErrorKeys.BILLING.SUBSCRIPTION_ALREADY_CANCELED
    };
  }
  if (mode === 'immediate') return null;
  if (sub.status === 'incomplete') {
    return {
      message: 'This subscription has no paid period to end.',
      errorKey: ErrorKeys.BILLING.CANCELLATION_ALREADY_SCHEDULED
    };
  }
  if (sub.cancelAtPeriodEnd) {
    return {
      message: 'A cancellation is already scheduled for the end of the period.',
      errorKey: ErrorKeys.BILLING.CANCELLATION_ALREADY_SCHEDULED
    };
  }
  return null;
}

/**
 * Mirrors `cancelOpenSubscription` of the server, which both cancel routes
 * share. Returns false after it sent the refusal.
 */
function cancelOpenSubscription(
  res: Response,
  sub: MockSubscription,
  mode: CancelMode
): boolean {
  const refusal = cancelRefusal(sub, mode);
  if (refusal) {
    sendError(res, refusal.errorKey, refusal.message);
    return false;
  }

  if (mode === 'immediate') {
    // Ending a metered period now means its postpaid units are owed now. A
    // provider-managed row is billed by its cancel webhook instead, and a
    // period-end cancel by the renewal scan at the boundary.
    if (sub.lifecycleOwner === 'self') billClosingUsagePeriod(sub);
    sub.status = 'canceled';
    sub.cancelAtPeriodEnd = false;
  } else {
    sub.cancelAtPeriodEnd = true;
  }
  sub.updatedAt = new Date().toISOString();
  // Only an immediate cancel revokes access now; a period-end cancel leaves
  // entitlements untouched until the boundary, so it pushes nothing.
  if (mode === 'immediate') notifyEntitlementsChanged(sub.customerId);
  return true;
}

// POST /billing/subscription/cancel — cancel current sub (period-end default).
billingRouter.post(
  '/subscription/cancel',
  authGuard,
  (req: Request, res: Response) => {
    const { user } = req as AuthenticatedRequest;
    if (rejectInvalid(res, cancelBodyErrors(req.body))) return;
    const mode = req.body?.mode ?? 'period_end';

    const customer = findCustomer(user.id);
    const sub = customer ? findCurrentSubscription(customer.id) : undefined;
    if (!sub) {
      sendError(
        res,
        ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION,
        'No active subscription to cancel'
      );
      return;
    }

    if (!cancelOpenSubscription(res, sub, mode)) return;
    res.json(toSubscriptionResponse(sub));
  }
);

// GET /billing/region — current override + detected geo default + effective.
billingRouter.get('/region', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  if (customer) {
    res.json(regionView(user, customer));
    return;
  }
  const { country } = geoFromLocale(user.locale);
  res.json(regionView(user, { providerOverride: null, country }));
});

// PUT /billing/region — set the region for the next checkout.
billingRouter.put('/region', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const region = (req.body as Record<string, unknown> | undefined)?.['region'];
  if (
    rejectInvalid(res, [
      ...unknownPropertyErrors(req.body, ['region']),
      ...oneOfErrors('region', region, ['auto', 'ru', 'world'])
    ])
  ) {
    return;
  }

  const customer = getOrCreateCustomer(user.id, user.locale);
  const newOverride = overrideForRegion(region as BillingRegion);
  const newEffective = newOverride ?? geoDefault(customer.country);

  if (!isProviderAvailable(newEffective, user)) {
    sendError(
      res,
      ErrorKeys.BILLING.REGION_UNAVAILABLE,
      'Payments are not available in this billing region.'
    );
    return;
  }

  const open = findCurrentSubscription(customer.id);
  if (open && open.provider !== newEffective) {
    if (open.status !== 'incomplete' || open.lifecycleOwner !== 'self') {
      sendError(
        res,
        ErrorKeys.BILLING.REGION_CHANGE_BLOCKED,
        'Cancel the current subscription before changing your billing region.'
      );
      return;
    }
    // Release the unpaid self-managed checkout, as checkout does.
    open.status = 'canceled';
    open.updatedAt = new Date().toISOString();
  }

  customer.providerOverride = newOverride;
  customer.updatedAt = new Date().toISOString();
  res.json(regionView(user, customer));
});

// GET /billing/premium-content — worked example of @RequireEntitlement('reports').
billingRouter.get(
  '/premium-content',
  authGuard,
  (req: Request, res: Response) => {
    const { user } = req as AuthenticatedRequest;
    if (!resolveEntitlements(user.id).capabilities.includes('reports')) {
      sendError(
        res,
        ErrorKeys.BILLING.ENTITLEMENT_REQUIRED,
        'This action requires the "reports" entitlement'
      );
      return;
    }
    res.json({ available: true });
  }
);

// ---------------------------------------------------------------------------
// Admin billing. Every route carries CASL `manage Billing`: 401
// unauthenticated, 403 without the permission. Reads and mutations are
// addressed by entity id across all customers (no per-caller scoping).
// ---------------------------------------------------------------------------
const billingAdminRouter = Router();

// Mirrors the server's @LogAudit on the admin billing mutations: the entry is
// written only after the handler has succeeded, with the same action names,
// target types and projected detail fields.
function auditAdminAction(
  req: Request,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>
): void {
  const { user } = req as AuthenticatedRequest;
  logAudit(action, {
    actorId: user?.id ?? null,
    actorEmail: user?.email ?? null,
    targetId,
    targetType,
    details,
    ip: req.ip
  });
}

billingAdminRouter.get(
  '/subscriptions',
  permissionGuard('search', 'Billing'),
  (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const errors = listQueryErrors(query, SUBSCRIPTION_LIST_QUERY);
    if (rejectInvalid(res, errors, 'query')) return;
    if (rejectInvalidCursor(res, query)) return;

    const page = listPage(
      [...getState().billingSubscriptions.values()],
      SUBSCRIPTION_LIST_QUERY,
      query
    );
    res.json({
      data: page.data.map(toSubscriptionResponse),
      meta: page.meta
    });
  }
);

billingAdminRouter.get(
  '/invoices',
  permissionGuard('search', 'Billing'),
  (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const errors = listQueryErrors(query, INVOICE_LIST_QUERY);
    if (rejectInvalid(res, errors, 'query')) return;
    if (rejectInvalidCursor(res, query)) return;

    const page = listPage(
      [...getState().billingInvoices.values()],
      INVOICE_LIST_QUERY,
      query
    );
    res.json({ data: page.data.map(toInvoiceResponse), meta: page.meta });
  }
);

billingAdminRouter.post(
  '/subscriptions/:id/cancel',
  permissionGuard('update', 'Billing'),
  requireUuid('id'),
  (req: Request, res: Response) => {
    if (rejectInvalid(res, cancelBodyErrors(req.body))) return;
    const mode = req.body?.mode ?? 'period_end';

    const sub = getState().billingSubscriptions.get(
      (req.params['id'] as string) ?? ''
    );
    if (!sub) {
      sendError(
        res,
        ErrorKeys.BILLING.SUBSCRIPTION_NOT_FOUND,
        'Subscription not found'
      );
      return;
    }
    if (!cancelOpenSubscription(res, sub, mode)) return;
    auditAdminAction(
      req,
      'BILLING_SUBSCRIPTION_CANCEL',
      'Subscription',
      sub.id,
      { mode }
    );
    res.json(toSubscriptionResponse(sub));
  }
);

// A full refund of a one-time purchase takes back what it granted, mirroring
// the server's BillingAdminService: the sku's CustomerGrant is revoked, which
// tells the owner, and a credit pack's units are clawed back (the balance may
// go negative, which blocks further usage until topped up). Partial refunds
// keep the invoice `paid`, so grants and credits survive them by construction.
function revokeOneTimeEffects(invoice: MockInvoice): void {
  if (invoice.kind !== 'one_time') return;
  const state = getState();
  const nowIso = new Date().toISOString();

  let revoked = false;
  for (const grant of state.billingCustomerGrants.values()) {
    if (grant.sourceInvoiceId === invoice.id && !grant.revokedAt) {
      grant.revokedAt = nowIso;
      revoked = true;
    }
  }
  if (revoked) notifyEntitlementsChanged(invoice.customerId);

  const product = invoice.productId
    ? state.billingProducts.get(invoice.productId)
    : undefined;
  if (product?.type !== 'credits' || !product.grant?.credits) return;
  const balance = state.billingCreditBalances.get(invoice.customerId);
  if (balance) {
    balance.balanceUnits -= product.grant.credits;
    balance.updatedAt = nowIso;
  } else {
    state.billingCreditBalances.set(invoice.customerId, {
      customerId: invoice.customerId,
      balanceUnits: -product.grant.credits,
      updatedAt: nowIso
    });
  }
}

billingAdminRouter.post(
  '/invoices/:id/refund',
  permissionGuard('refund', 'Billing'),
  requireUuid('id'),
  (req: Request, res: Response) => {
    const amountMinor = (req.body as Record<string, unknown> | undefined)?.[
      'amountMinor'
    ] as number | undefined;
    // The DTO's @IsInt()/@Min(1) run in the global pipe, before the handler, so
    // a supplied 0 or a fractional amount is a 400 whether or not the invoice
    // exists and never reaches the remaining-total check.
    if (
      rejectInvalid(res, [
        ...unknownPropertyErrors(req.body, ['amountMinor']),
        ...intErrors('amountMinor', amountMinor, {
          min: 1,
          optional: 'nullable'
        })
      ])
    ) {
      return;
    }

    const invoice = getState().billingInvoices.get(
      (req.params['id'] as string) ?? ''
    );
    if (!invoice) {
      sendError(res, ErrorKeys.BILLING.INVOICE_NOT_FOUND, 'Invoice not found');
      return;
    }
    if (invoice.status !== 'paid') {
      sendError(
        res,
        ErrorKeys.BILLING.INVOICE_NOT_REFUNDABLE,
        'Only paid invoices can be refunded'
      );
      return;
    }

    const alreadyRefunded = invoice.refundedMinor ?? 0;
    const remaining = invoice.amountMinor - alreadyRefunded;
    const refundAmount = amountMinor ?? remaining;
    if (refundAmount <= 0 || refundAmount > remaining) {
      sendError(
        res,
        ErrorKeys.BILLING.REFUND_AMOUNT_OUT_OF_RANGE,
        'Refund amount must be between 1 and the remaining refundable total'
      );
      return;
    }

    const cumulativeRefunded = alreadyRefunded + refundAmount;
    invoice.refundedMinor = cumulativeRefunded;
    if (cumulativeRefunded >= invoice.amountMinor) {
      invoice.status = 'refunded';
      revokeOneTimeEffects(invoice);
    }
    invoice.updatedAt = new Date().toISOString();
    auditAdminAction(req, 'BILLING_INVOICE_REFUND', 'Invoice', invoice.id, {
      amountMinor: amountMinor ?? null
    });
    res.json(toInvoiceResponse(invoice));
  }
);

// Mirrors BillingAdminService.replayWebhookEvent: only a `dead_letter` row is
// reset to `received` for the reconciliation sweep.
billingAdminRouter.post(
  '/webhook-events/:id/replay',
  permissionGuard('update', 'Billing'),
  requireUuid('id'),
  (req: Request, res: Response) => {
    const event = getState().billingWebhookEvents.get(
      (req.params['id'] as string) ?? ''
    );
    if (!event) {
      sendError(
        res,
        ErrorKeys.BILLING.WEBHOOK_EVENT_NOT_FOUND,
        'Webhook event not found'
      );
      return;
    }
    if (event.status !== 'dead_letter') {
      sendError(
        res,
        ErrorKeys.BILLING.WEBHOOK_EVENT_NOT_REPLAYABLE,
        'Only dead-lettered webhook events can be replayed'
      );
      return;
    }
    event.status = 'received';
    event.attempts = 0;
    event.lastError = null;
    auditAdminAction(
      req,
      'BILLING_WEBHOOK_EVENT_REPLAY',
      'WebhookEvent',
      event.id,
      {
        status: 'received'
      }
    );
    res.json({ id: event.id, status: 'received' });
  }
);

// Metering ingest. Mirrors RecordUsageRequestDto validation, the
// active-subscription requirement, and idempotency on `idempotencyKey`. There is
// no public meter endpoint — this lives under the `manage Billing` admin guard.
billingAdminRouter.post(
  '/usage',
  permissionGuard('create', 'Billing'),
  (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const occurredAtRaw = body['occurredAt'];

    if (
      rejectInvalid(res, [
        ...unknownPropertyErrors(body, [
          'customerId',
          'meterKey',
          'quantity',
          'occurredAt',
          'idempotencyKey'
        ]),
        ...uuidErrors('customerId', body['customerId']),
        ...trimmedStringErrors('meterKey', body['meterKey'], {
          min: 1,
          max: 100
        }),
        ...intErrors('quantity', body['quantity'], {
          min: 1,
          max: 1_000_000_000
        }),
        ...iso8601Errors('occurredAt', occurredAtRaw),
        ...trimmedStringErrors('idempotencyKey', body['idempotencyKey'], {
          min: 1,
          max: 255
        })
      ])
    ) {
      return;
    }

    const customerId = (body['customerId'] as string).trim();
    const meterKey = (body['meterKey'] as string).trim();
    const quantity = body['quantity'] as number;
    const idempotencyKey = (body['idempotencyKey'] as string).trim();

    const state = getState();

    // Idempotent replay: this customer already has a record for the key — return
    // it as-is. Scoped to the customer, like the server's unique constraint: the
    // same key from another customer is a distinct event, not a replay.
    const existing = [...state.billingUsageRecords.values()].find(
      (r) => r.customerId === customerId && r.idempotencyKey === idempotencyKey
    );
    if (existing) {
      // The server audits by response, so an idempotent replay is recorded too,
      // pointing at the original record's id.
      auditAdminAction(
        req,
        'BILLING_USAGE_RECORD',
        'UsageRecord',
        existing.id,
        {
          customerId,
          meterKey,
          quantity
        }
      );
      res.status(201).json(toUsageResponse(existing));
      return;
    }

    // A negative balance means a refund clawed back already-spent credits: no
    // new usage may accrue until the debt is topped up. Replays above still
    // succeed — the record predates the block, exactly like the server.
    const creditBalance = state.billingCreditBalances.get(customerId);
    if (creditBalance && creditBalance.balanceUnits < 0) {
      sendError(
        res,
        ErrorKeys.BILLING.CREDITS_BLOCKED,
        'Credit balance is negative. Top up credits before recording more usage.'
      );
      return;
    }

    // Newest-first like the server, so usage is billed to the same subscription
    // the entitlement resolver reports.
    const subscription = [...state.billingSubscriptions.values()]
      .filter(
        (s) =>
          s.customerId === customerId &&
          ENTITLED_SUBSCRIPTION_STATUSES.includes(s.status)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!subscription) {
      sendError(
        res,
        ErrorKeys.BILLING.CUSTOMER_NO_ACTIVE_SUBSCRIPTION,
        'No active subscription for customer to record usage against'
      );
      return;
    }

    // A record is an observation, so the customer's current plan does not gate it
    // — rating decides at period close. Only a meter no plan declares is refused:
    // it can never become chargeable and is a producer typo.
    if (![...state.plans.values()].some((p) => p.meterKey === meterKey)) {
      sendError(
        res,
        ErrorKeys.BILLING.METER_NOT_DECLARED,
        `Meter "${meterKey}" is not declared by any plan`
      );
      return;
    }

    // The server refuses a record that no rating can reach: one before the
    // open metered window, and one past the clock skew tolerance.
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const occurredAt =
      typeof occurredAtRaw === 'string'
        ? new Date(occurredAtRaw).toISOString()
        : now;
    const occurredAtMs = new Date(occurredAt).getTime();
    if (occurredAtMs < new Date(usageIngestStart(subscription)).getTime()) {
      sendError(
        res,
        ErrorKeys.BILLING.USAGE_BEFORE_OPEN_WINDOW,
        'occurredAt is before the open metered window'
      );
      return;
    }
    if (occurredAtMs > nowMs + USAGE_FUTURE_TOLERANCE_MS) {
      sendError(
        res,
        ErrorKeys.BILLING.USAGE_IN_FUTURE,
        'occurredAt is in the future'
      );
      return;
    }

    const record: MockUsageRecord = {
      id: randomUUID(),
      customerId,
      subscriptionId: subscription.id,
      meterKey,
      quantity,
      occurredAt,
      idempotencyKey,
      recordedAt: now
    };
    state.billingUsageRecords.set(record.id, record);
    auditAdminAction(req, 'BILLING_USAGE_RECORD', 'UsageRecord', record.id, {
      customerId,
      meterKey,
      quantity
    });
    res.status(201).json(toUsageResponse(record));
  }
);

export default router;
export { billingRouter, billingAdminRouter };
