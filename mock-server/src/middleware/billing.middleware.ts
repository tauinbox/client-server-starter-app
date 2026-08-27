import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  BillingProviderId,
  BillingRegion,
  EntitlementLimitKey,
  EntitlementsResponse,
  PlanResponse,
  ProrationPreviewResponse,
  UsageSummaryResponse
} from '@app/shared/types';
import {
  ALLOWED_INVOICE_SORT_COLUMNS,
  ALLOWED_SUBSCRIPTION_SORT_COLUMNS,
  CHANGEABLE_SUBSCRIPTION_STATUSES,
  ENTITLED_SUBSCRIPTION_STATUSES,
  OPEN_SUBSCRIPTION_STATUSES
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
import { adminGuard, authGuard } from '../helpers/auth.helpers';
import {
  billClosingUsagePeriod,
  sumPlanMeterUnits
} from '../helpers/billing.helpers';
import { pushToUser } from '../sse-hub';
import {
  cursorPaginate,
  cursorQueryErrors,
  parseCursorQuery
} from '../helpers/pagination.helpers';
import { addInterval } from '../utils/period';
import type {
  AuthenticatedRequest,
  MockCustomer,
  MockInvoice,
  MockPaymentMethod,
  MockPlan,
  MockSubscription,
  MockUsageRecord
} from '../types';
import {
  requireUuid,
  validationError
} from '../helpers/validation-error.helpers';
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
const CANCEL_MODES = ['period_end', 'immediate'] as const;

/**
 * Replies with the class-validator envelope and returns true when anything
 * failed. Each handler states the keys of its own request DTO and collects the
 * messages in the order the server reports them: unknown properties first
 * (the pipe whitelists before it validates), then each property as declared.
 */
function rejectInvalidBody(res: Response, errors: string[]): boolean {
  if (errors.length === 0) return false;
  res.status(400).json(validationError(errors));
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

// Provider webhook receivers. Public — providers verify their own authenticity,
// so there is no JWT. The mock has no real signature to check, so it mirrors
// only the server's observable status contract: a missing/empty body is a 400
// (the server's "Missing webhook body" guard), any payload is accepted with the
// 200 success shape. Synthetic lifecycle injection is driven through /__control.
function handleWebhook(req: Request, res: Response): void {
  if (!req.body || Object.keys(req.body).length === 0) {
    res.status(400).json({ message: 'Missing webhook body', statusCode: 400 });
    return;
  }
  res.status(200).json({ received: true });
}

router.post('/paddle', handleWebhook);
router.post('/yookassa', handleWebhook);

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

function geoFromLocale(locale: string): { country: string; currency: string } {
  return locale.toLowerCase().startsWith('ru')
    ? { country: 'RU', currency: 'RUB' }
    : { country: 'US', currency: 'USD' };
}

function geoDefault(country: string): BillingProviderId {
  return country.toUpperCase() === 'RU' ? 'yookassa' : 'paddle';
}

// Mock treats both providers as configured, so lifecycle
// ownership is purely the provider's: YooKassa self-managed, Paddle managed.
function managesLifecycle(provider: BillingProviderId): boolean {
  return provider !== 'yookassa';
}

function overrideForRegion(region: BillingRegion): BillingProviderId | null {
  if (region === 'ru') return 'yookassa';
  if (region === 'world') return 'paddle';
  return null;
}

function regionForOverride(override: BillingProviderId | null): BillingRegion {
  if (override === 'yookassa') return 'ru';
  if (override === 'paddle') return 'world';
  return 'auto';
}

function effectiveProvider(customer: MockCustomer): BillingProviderId {
  return customer.providerOverride ?? geoDefault(customer.country);
}

function findCustomer(userId: string): MockCustomer | undefined {
  for (const customer of getState().billingCustomers.values()) {
    if (customer.userId === userId) return customer;
  }
  return undefined;
}

/** Plan key of the default (no-subscription) tier - mirrors FREE_PLAN_KEY. */
const FREE_PLAN_KEY = 'free';

/**
 * Mirrors the server's entitlement-changed listener: a billing change that
 * moves what the plan grants tells that one client, never a broadcast.
 */
function notifyEntitlementsChanged(userId: string): void {
  pushToUser(userId, { type: 'entitlements_updated', userId });
}

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
    id: uuidv4(),
    userId,
    provider: geoDefault(country),
    providerOverride: null,
    country,
    currency,
    defaultPaymentMethodId: null,
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
  const errors = cursorQueryErrors(query, {
    sortColumns: ALLOWED_INVOICE_SORT_COLUMNS
  });
  if (rejectInvalidBody(res, errors)) return;
  const params = parseCursorQuery(query);

  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  const invoices = customer
    ? [...getState().billingInvoices.values()].filter(
        (i) => i.customerId === customer.id
      )
    : [];
  const page = cursorPaginate(invoices, params);
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
  const plan = [...getState().plans.values()].find(
    (p) => p.key === sub.planKey
  );
  const price = plan?.prices[sub.provider];
  if (!plan || !price) {
    res.json(null);
    return;
  }

  const totalUnits = sumPlanMeterUnits(
    plan,
    sub.id,
    sub.currentPeriodStart,
    sub.currentPeriodEnd
  );

  const includedUnits = price.includedUnits ?? 0;
  const unitPriceMinor = price.unitPriceMinor ?? 0;
  const billableUnits = Math.max(0, totalUnits - includedUnits);
  const summary: UsageSummaryResponse = {
    subscriptionId: sub.id,
    meterKey: plan.meterKey,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
    totalUnits,
    includedUnits,
    billableUnits,
    unitPriceMinor,
    amountMinor: billableUnits * unitPriceMinor,
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
      res.status(404).json({
        message: 'No active subscription to update the payment method for',
        statusCode: 404
      });
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
      id: uuidv4(),
      customerId: customer.id,
      provider: sub.provider,
      providerMethodRef: `pm_${uuidv4()}`,
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

    const sessionRef = uuidv4();
    res.json({
      provider: sub.provider,
      url: `https://mock-checkout.local/${sub.provider}/method/${sessionRef}`,
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
// provider 409, misconfigured catalog 503, custom amount required and bounded
// 400. The provider session is recorded as a pending purchase that
// /__control/billing/complete-purchase settles the way the paid webhook would.
billingRouter.post('/purchase', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const body = req.body as Record<string, unknown> | undefined;
  if (
    rejectInvalidBody(res, [
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
    res.status(404).json({
      message: `Product "${productKey}" was not found`,
      statusCode: 404
    });
    return;
  }

  const customer = getOrCreateCustomer(user.id, user.locale);
  const provider = effectiveProvider(customer);
  const price = product.prices[provider];
  if (!price) {
    res.status(409).json({
      message: `Product "${product.key}" is not available for your billing provider.`,
      statusCode: 409
    });
    return;
  }

  // Amount resolution mirrors the server's threat model: fixed-price products
  // charge the catalog price (client amount ignored); custom requires a
  // client amount inside the configured bounds.
  let amountMinor: number;
  if (product.type !== 'custom') {
    if (!price.amountMinor || price.amountMinor <= 0) {
      res.status(503).json({
        message: `Product "${product.key}" has no price configured`,
        statusCode: 503
      });
      return;
    }
    amountMinor = price.amountMinor;
  } else {
    const { minAmountMinor, maxAmountMinor } = price;
    // `== null`, not falsy: a configured lower bound of 0 (any amount the
    // request already has to be >= 1 for) is legitimate, not "unconfigured".
    if (minAmountMinor == null || maxAmountMinor == null) {
      res.status(503).json({
        message: `Product "${product.key}" has no amount bounds configured`,
        statusCode: 503
      });
      return;
    }
    if (requestedMinor === undefined) {
      res.status(400).json({
        message: 'amountMinor is required for a custom-amount product',
        statusCode: 400
      });
      return;
    }
    if (requestedMinor < minAmountMinor || requestedMinor > maxAmountMinor) {
      res.status(400).json({
        message: `amountMinor must be between ${minAmountMinor} and ${maxAmountMinor}`,
        statusCode: 400
      });
      return;
    }
    amountMinor = requestedMinor;
  }

  const sessionRef = uuidv4();
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
    url: `https://mock-checkout.local/${provider}/purchase/${sessionRef}`,
    sessionRef
  });
});

// POST /billing/checkout — start a hosted checkout for a plan.
billingRouter.post('/checkout', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  if (rejectInvalidBody(res, planKeyBodyErrors(req.body))) return;
  const planKey = (
    (req.body as Record<string, unknown>)['planKey'] as string
  ).trim();

  const plan = [...getState().plans.values()].find(
    (p) => p.key === planKey && p.active
  );
  if (!plan) {
    res
      .status(404)
      .json({ message: `Plan "${planKey}" was not found`, statusCode: 404 });
    return;
  }

  const customer = getOrCreateCustomer(user.id, user.locale);

  const hasActive = [...getState().billingSubscriptions.values()].some(
    (s) =>
      s.customerId === customer.id &&
      ENTITLED_SUBSCRIPTION_STATUSES.includes(s.status)
  );
  if (hasActive) {
    res.status(409).json({
      message:
        'You already have an active subscription. Cancel it before subscribing to another plan.',
      statusCode: 409
    });
    return;
  }

  const provider = effectiveProvider(customer);

  // A prior unpaid checkout leaves an `incomplete` row. Reuse it rather than
  // stack a second open subscription (the server enforces this with a partial
  // unique index; mirror the observable single-open-subscription behavior here).
  const pending = [...getState().billingSubscriptions.values()].find(
    (s) => s.customerId === customer.id && s.status === 'incomplete'
  );

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
      trialEnd:
        plan.trialDays > 0
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
        id: uuidv4(),
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

  const sessionRef = uuidv4();
  res.json({
    provider,
    url: `https://mock-checkout.local/${provider}/${sessionRef}`,
    sessionRef
  });
});

// ---------------------------------------------------------------------------
// Plan change with proration. Mirrors the server's guards and
// ProrationCalculator math (whole-day granularity, refund-and-recharge). The
// server's Paddle path delegates the money to Paddle and reconciles invoices
// via webhooks; the mock has no provider, so both providers settle the same
// synchronous way — the documented divergence is timing, not shape.
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;

interface MockProrationQuote {
  remainderDays: number;
  totalDays: number;
  currency: string;
  refundMinor: number;
  chargeMinor: number;
}

function prorationQuote(
  fromPlan: MockPlan,
  toPlan: MockPlan,
  provider: BillingProviderId,
  sub: MockSubscription,
  now: Date
): MockProrationQuote {
  const periodStart = new Date(sub.currentPeriodStart).getTime();
  const periodEnd = new Date(sub.currentPeriodEnd).getTime();
  const totalDays = Math.max(1, Math.round((periodEnd - periodStart) / DAY_MS));
  const remainderDays = Math.min(
    totalDays,
    Math.max(0, Math.ceil((periodEnd - now.getTime()) / DAY_MS))
  );
  const fromMinor = fromPlan.prices[provider]?.amountMinor ?? 0;
  const toMinor = toPlan.prices[provider]?.amountMinor ?? 0;
  return {
    remainderDays,
    totalDays,
    currency:
      toPlan.prices[provider]?.currency ??
      fromPlan.prices[provider]?.currency ??
      'USD',
    refundMinor: Math.floor((fromMinor * remainderDays) / totalDays),
    chargeMinor: Math.floor((toMinor * remainderDays) / totalDays)
  };
}

interface ChangeGuardResult {
  customer: MockCustomer;
  sub: MockSubscription;
  fromPlan: MockPlan;
  toPlan: MockPlan;
}

/** Shared guards of change/preview; replies with the error and returns null. */
function guardChange(req: Request, res: Response): ChangeGuardResult | null {
  const { user } = req as AuthenticatedRequest;
  if (rejectInvalidBody(res, planKeyBodyErrors(req.body))) return null;
  const planKey = (
    (req.body as Record<string, unknown>)['planKey'] as string
  ).trim();

  const customer = findCustomer(user.id);
  const sub = customer ? findCurrentSubscription(customer.id) : undefined;
  if (!customer || !sub) {
    res
      .status(404)
      .json({ message: 'No active subscription to change', statusCode: 404 });
    return null;
  }
  if (!CHANGEABLE_SUBSCRIPTION_STATUSES.includes(sub.status)) {
    res.status(409).json({
      message:
        'The subscription must be active to change plans. Settle any outstanding payment first.',
      statusCode: 409
    });
    return null;
  }
  if (sub.cancelAtPeriodEnd) {
    res.status(409).json({
      message:
        'A cancellation is scheduled for this subscription; it can no longer change plans.',
      statusCode: 409
    });
    return null;
  }

  const toPlan = [...getState().plans.values()].find(
    (p) => p.key === planKey && p.active
  );
  if (!toPlan) {
    res
      .status(404)
      .json({ message: `Plan "${planKey}" was not found`, statusCode: 404 });
    return null;
  }
  if (toPlan.key === sub.planKey) {
    res
      .status(409)
      .json({ message: 'You are already on this plan.', statusCode: 409 });
    return null;
  }
  if (!toPlan.prices[sub.provider]) {
    res.status(409).json({
      message: `Plan "${toPlan.key}" is not available for your billing provider.`,
      statusCode: 409
    });
    return null;
  }

  const fromPlan = [...getState().plans.values()].find(
    (p) => p.key === sub.planKey
  );
  if (!fromPlan) {
    res.status(503).json({
      message: 'The current plan is missing from the catalog',
      statusCode: 503
    });
    return null;
  }

  return { customer, sub, fromPlan, toPlan };
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

    // Trial moves no money; a paid period settles the charge + refund legs.
    if (sub.status !== 'trialing') {
      const quote = prorationQuote(fromPlan, toPlan, sub.provider, sub, now);
      const state = getState();

      // Resolved before the new charge is recorded so the charge can't become
      // its own refund source (the server has a provider call in between, so it
      // excludes its charge row by id instead), and capped by the remainder.
      const source = [...state.billingInvoices.values()]
        .filter(
          (i) =>
            i.subscriptionId === sub.id &&
            i.status === 'paid' &&
            i.billingMode === 'fixed' &&
            i.amountMinor > 0
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const refundMinor = source
        ? Math.min(
            quote.refundMinor,
            source.amountMinor - (source.refundedMinor ?? 0)
          )
        : 0;

      if (quote.chargeMinor > 0) {
        const charge: MockInvoice = {
          id: uuidv4(),
          customerId: customer.id,
          subscriptionId: sub.id,
          provider: sub.provider,
          providerInvoiceRef: `in_${uuidv4()}`,
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
          id: uuidv4(),
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
      }
    }

    sub.planKey = toPlan.key;
    sub.billingMode = toPlan.billingMode;
    sub.updatedAt = nowIso;
    notifyEntitlementsChanged(customer.userId);
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
    const quote = prorationQuote(
      fromPlan,
      toPlan,
      sub.provider,
      sub,
      new Date()
    );
    const trial = sub.status === 'trialing';
    const refundMinor = trial ? 0 : quote.refundMinor;
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

// POST /billing/subscription/cancel — cancel current sub (period-end default).
billingRouter.post(
  '/subscription/cancel',
  authGuard,
  (req: Request, res: Response) => {
    const { user } = req as AuthenticatedRequest;
    if (rejectInvalidBody(res, cancelBodyErrors(req.body))) return;
    const mode = req.body?.mode ?? 'period_end';

    const customer = findCustomer(user.id);
    const sub = customer ? findCurrentSubscription(customer.id) : undefined;
    if (!sub) {
      res
        .status(404)
        .json({ message: 'No active subscription to cancel', statusCode: 404 });
      return;
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
    if (mode === 'immediate') notifyEntitlementsChanged(user.id);
    res.json(toSubscriptionResponse(sub));
  }
);

// GET /billing/region — current override + detected geo default + effective.
billingRouter.get('/region', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  if (customer) {
    res.json({
      region: regionForOverride(customer.providerOverride),
      detectedProvider: geoDefault(customer.country),
      effectiveProvider: effectiveProvider(customer)
    });
    return;
  }
  const { country } = geoFromLocale(user.locale);
  const detected = geoDefault(country);
  res.json({
    region: 'auto',
    detectedProvider: detected,
    effectiveProvider: detected
  });
});

// PUT /billing/region — set the region for the next checkout.
billingRouter.put('/region', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const region = (req.body as Record<string, unknown> | undefined)?.['region'];
  if (
    rejectInvalidBody(res, [
      ...unknownPropertyErrors(req.body, ['region']),
      ...oneOfErrors('region', region, ['auto', 'ru', 'world'])
    ])
  ) {
    return;
  }

  const customer = getOrCreateCustomer(user.id, user.locale);
  const newOverride = overrideForRegion(region as BillingRegion);
  const newEffective = newOverride ?? geoDefault(customer.country);

  const open = findCurrentSubscription(customer.id);
  if (open && open.provider !== newEffective) {
    res.status(409).json({
      message:
        'Cancel the current subscription before changing your billing region.',
      statusCode: 409
    });
    return;
  }

  customer.providerOverride = newOverride;
  customer.updatedAt = new Date().toISOString();
  res.json({
    region: regionForOverride(customer.providerOverride),
    detectedProvider: geoDefault(customer.country),
    effectiveProvider: effectiveProvider(customer)
  });
});

// GET /billing/premium-content — worked example of @RequireEntitlement('reports').
billingRouter.get(
  '/premium-content',
  authGuard,
  (req: Request, res: Response) => {
    const { user } = req as AuthenticatedRequest;
    if (!resolveEntitlements(user.id).capabilities.includes('reports')) {
      res.status(403).json({
        message: 'This action requires the "reports" entitlement',
        statusCode: 403
      });
      return;
    }
    res.json({ available: true });
  }
);

// ---------------------------------------------------------------------------
// Admin billing. CASL `manage Billing` is mirrored by adminGuard:
// 401 unauthenticated, 403 non-admin. Reads and mutations are addressed by
// entity id across all customers (no per-caller scoping).
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
  adminGuard,
  (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const errors = cursorQueryErrors(query, {
      sortColumns: ALLOWED_SUBSCRIPTION_SORT_COLUMNS
    });
    if (rejectInvalidBody(res, errors)) return;
    const params = parseCursorQuery(query);

    const page = cursorPaginate(
      [...getState().billingSubscriptions.values()],
      params
    );
    res.json({
      data: page.data.map(toSubscriptionResponse),
      meta: page.meta
    });
  }
);

billingAdminRouter.get(
  '/invoices',
  adminGuard,
  (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const errors = cursorQueryErrors(query, {
      sortColumns: ALLOWED_INVOICE_SORT_COLUMNS
    });
    if (rejectInvalidBody(res, errors)) return;
    const params = parseCursorQuery(query);

    const page = cursorPaginate(
      [...getState().billingInvoices.values()],
      params
    );
    res.json({ data: page.data.map(toInvoiceResponse), meta: page.meta });
  }
);

billingAdminRouter.post(
  '/subscriptions/:id/cancel',
  adminGuard,
  requireUuid('id'),
  (req: Request, res: Response) => {
    if (rejectInvalidBody(res, cancelBodyErrors(req.body))) return;
    const mode = req.body?.mode ?? 'period_end';

    const sub = getState().billingSubscriptions.get(
      (req.params['id'] as string) ?? ''
    );
    if (!sub) {
      res
        .status(404)
        .json({ message: 'Subscription not found', statusCode: 404 });
      return;
    }
    // Addressed by id, so a canceled row can be handed in — the self-service
    // route cannot reach one because it looks up through the open statuses.
    if (!OPEN_SUBSCRIPTION_STATUSES.includes(sub.status)) {
      res.status(409).json({
        message: 'This subscription is already canceled.',
        statusCode: 409
      });
      return;
    }

    if (mode === 'immediate') {
      if (sub.lifecycleOwner === 'self') billClosingUsagePeriod(sub);
      sub.status = 'canceled';
      sub.cancelAtPeriodEnd = false;
    } else {
      sub.cancelAtPeriodEnd = true;
    }
    sub.updatedAt = new Date().toISOString();
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
// the server's BillingAdminService: the sku's CustomerGrant is revoked and a
// credit pack's units are clawed back (the balance may go negative, which
// blocks further usage until topped up). Partial refunds keep the invoice
// `paid`, so grants and credits survive them by construction.
function revokeOneTimeEffects(invoice: MockInvoice): void {
  if (invoice.kind !== 'one_time') return;
  const state = getState();
  const nowIso = new Date().toISOString();

  for (const grant of state.billingCustomerGrants.values()) {
    if (grant.sourceInvoiceId === invoice.id && !grant.revokedAt) {
      grant.revokedAt = nowIso;
    }
  }

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
  adminGuard,
  requireUuid('id'),
  (req: Request, res: Response) => {
    const amountMinor = (req.body as Record<string, unknown> | undefined)?.[
      'amountMinor'
    ] as number | undefined;
    // The DTO's @IsInt()/@Min(1) run in the global pipe, before the handler, so
    // a supplied 0 or a fractional amount is a 400 whether or not the invoice
    // exists and never reaches the remaining-total check.
    if (
      rejectInvalidBody(res, [
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
      res.status(404).json({ message: 'Invoice not found', statusCode: 404 });
      return;
    }
    if (invoice.status !== 'paid') {
      res.status(409).json({
        message: 'Only paid invoices can be refunded',
        statusCode: 409
      });
      return;
    }

    const alreadyRefunded = invoice.refundedMinor ?? 0;
    const remaining = invoice.amountMinor - alreadyRefunded;
    const refundAmount = amountMinor ?? remaining;
    if (refundAmount <= 0 || refundAmount > remaining) {
      res.status(400).json({
        message:
          'Refund amount must be between 1 and the remaining refundable total',
        statusCode: 400
      });
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

// The mock webhook receiver is a no-op stub with no event ledger, so there is
// never a dead-lettered row to replay; the route exists only to mirror the
// server's auth contract (401 unauthenticated / 403 non-admin), then 404.
billingAdminRouter.post(
  '/webhook-events/:id/replay',
  adminGuard,
  requireUuid('id'),
  (_req: Request, res: Response) => {
    res
      .status(404)
      .json({ message: 'Webhook event not found', statusCode: 404 });
  }
);

// Metering ingest. Mirrors RecordUsageRequestDto validation, the
// active-subscription requirement, and idempotency on `idempotencyKey`. There is
// no public meter endpoint — this lives under the `manage Billing` admin guard.
billingAdminRouter.post('/usage', adminGuard, (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const occurredAtRaw = body['occurredAt'];

  if (
    rejectInvalidBody(res, [
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
    auditAdminAction(req, 'BILLING_USAGE_RECORD', 'UsageRecord', existing.id, {
      customerId,
      meterKey,
      quantity
    });
    res.status(201).json(toUsageResponse(existing));
    return;
  }

  // A negative balance means a refund clawed back already-spent credits: no
  // new usage may accrue until the debt is topped up. Replays above still
  // succeed — the record predates the block, exactly like the server.
  const creditBalance = state.billingCreditBalances.get(customerId);
  if (creditBalance && creditBalance.balanceUnits < 0) {
    res.status(409).json({
      message:
        'Credit balance is negative. Top up credits before recording more usage.',
      statusCode: 409
    });
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
    res.status(404).json({
      message: 'No active subscription for customer to record usage against',
      statusCode: 404
    });
    return;
  }

  // A record is an observation, so the customer's current plan does not gate it
  // — rating decides at period close. Only a meter no plan declares is refused:
  // it can never become chargeable and is a producer typo.
  if (![...state.plans.values()].some((p) => p.meterKey === meterKey)) {
    res.status(400).json({
      message: `Meter "${meterKey}" is not declared by any plan`,
      statusCode: 400
    });
    return;
  }

  const now = new Date().toISOString();
  const record: MockUsageRecord = {
    id: uuidv4(),
    customerId,
    subscriptionId: subscription.id,
    meterKey,
    quantity,
    occurredAt:
      typeof occurredAtRaw === 'string'
        ? new Date(occurredAtRaw).toISOString()
        : now,
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
});

export default router;
export { billingRouter, billingAdminRouter };
