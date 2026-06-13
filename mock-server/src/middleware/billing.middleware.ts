import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  BillingProviderId,
  BillingRegion,
  PlanResponse,
  ProrationPreviewResponse,
  UsageSummaryResponse
} from '@app/shared/types';
import {
  getState,
  toCreditBalanceResponse,
  toInvoiceResponse,
  toPaymentMethodResponse,
  toPlanResponse,
  toProductResponse,
  toSubscriptionResponse,
  toUsageResponse
} from '../state';
import { adminGuard, authGuard } from '../helpers/auth.helpers';
import type {
  AuthenticatedRequest,
  MockCustomer,
  MockInvoice,
  MockPaymentMethod,
  MockPlan,
  MockSubscription,
  MockUsageRecord
} from '../types';

const router = Router();

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

// Non-canceled statuses — the "current" subscription for read/cancel/region.
const OPEN_STATUSES: ReadonlyArray<MockSubscription['status']> = [
  'incomplete',
  'trialing',
  'active',
  'past_due'
];
// Entitlement-granting statuses (block re-checkout, resolve capabilities).
const ACTIVE_STATUSES: ReadonlyArray<MockSubscription['status']> = [
  'trialing',
  'active',
  'past_due'
];

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

function findCurrentSubscription(
  customerId: string
): MockSubscription | undefined {
  const subs = [...getState().billingSubscriptions.values()]
    .filter(
      (s) => s.customerId === customerId && OPEN_STATUSES.includes(s.status)
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return subs[0];
}

function addInterval(from: Date, interval: 'month' | 'year'): Date {
  const end = new Date(from);
  if (interval === 'year') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

// GET /billing/subscription — current subscription or null.
billingRouter.get('/subscription', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  const sub = customer ? findCurrentSubscription(customer.id) : undefined;
  res.json(sub ? toSubscriptionResponse(sub) : null);
});

// GET /billing/invoices — caller's invoices, newest first.
billingRouter.get('/invoices', authGuard, (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const customer = findCustomer(user.id);
  if (!customer) {
    res.json([]);
    return;
  }
  const invoices = [...getState().billingInvoices.values()]
    .filter((i) => i.customerId === customer.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toInvoiceResponse);
  res.json(invoices);
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

  const totalUnits = [...getState().billingUsageRecords.values()]
    .filter(
      (r) =>
        r.subscriptionId === sub.id &&
        r.occurredAt >= sub.currentPeriodStart &&
        r.occurredAt < sub.currentPeriodEnd
    )
    .reduce((sum, r) => sum + r.quantity, 0);

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
  const productKey =
    typeof req.body?.productKey === 'string' ? req.body.productKey.trim() : '';
  if (!productKey) {
    res
      .status(400)
      .json({ message: 'productKey must be a string', statusCode: 400 });
    return;
  }
  const requestedMinor = req.body?.amountMinor as unknown;
  if (
    requestedMinor !== undefined &&
    (!Number.isInteger(requestedMinor) || (requestedMinor as number) < 1)
  ) {
    res.status(400).json({
      message: 'amountMinor must be a positive integer',
      statusCode: 400
    });
    return;
  }

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
    if (!minAmountMinor || !maxAmountMinor) {
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
    const requested = requestedMinor as number;
    if (requested < minAmountMinor || requested > maxAmountMinor) {
      res.status(400).json({
        message: `amountMinor must be between ${minAmountMinor} and ${maxAmountMinor}`,
        statusCode: 400
      });
      return;
    }
    amountMinor = requested;
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
  const planKey =
    typeof req.body?.planKey === 'string' ? req.body.planKey.trim() : '';
  if (!planKey) {
    res
      .status(400)
      .json({ message: 'planKey must be a string', statusCode: 400 });
    return;
  }

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
    (s) => s.customerId === customer.id && ACTIVE_STATUSES.includes(s.status)
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
  if (!managesLifecycle(provider)) {
    const now = new Date();
    const sub: MockSubscription = {
      id: uuidv4(),
      customerId: customer.id,
      planKey: plan.key,
      provider,
      billingMode: plan.billingMode,
      status: 'incomplete',
      lifecycleOwner: 'self',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: addInterval(now, plan.interval).toISOString(),
      cancelAtPeriodEnd: false,
      trialEnd:
        plan.trialDays > 0
          ? new Date(now.getTime() + plan.trialDays * 86_400_000).toISOString()
          : null,
      paymentMethodId: null,
      providerSubscriptionId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    getState().billingSubscriptions.set(sub.id, sub);
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
const CHANGEABLE_STATUSES: ReadonlyArray<MockSubscription['status']> = [
  'trialing',
  'active'
];

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
  const planKey =
    typeof req.body?.planKey === 'string' ? req.body.planKey.trim() : '';
  if (!planKey) {
    res
      .status(400)
      .json({ message: 'planKey must be a string', statusCode: 400 });
    return null;
  }

  const customer = findCustomer(user.id);
  const sub = customer ? findCurrentSubscription(customer.id) : undefined;
  if (!customer || !sub) {
    res
      .status(404)
      .json({ message: 'No active subscription to change', statusCode: 404 });
    return null;
  }
  if (!CHANGEABLE_STATUSES.includes(sub.status)) {
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

      // Refund capped by the latest paid fixed invoice (nothing paid → nothing
      // to give back), mirroring the server's refund-source rule.
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
        ? Math.min(quote.refundMinor, source.amountMinor)
        : 0;
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
      }
    }

    sub.planKey = toPlan.key;
    sub.billingMode = toPlan.billingMode;
    sub.updatedAt = nowIso;
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
    const mode = req.body?.mode ?? 'period_end';
    if (mode !== 'period_end' && mode !== 'immediate') {
      res.status(400).json({
        message: 'mode must be one of: period_end, immediate',
        statusCode: 400
      });
      return;
    }

    const customer = findCustomer(user.id);
    const sub = customer ? findCurrentSubscription(customer.id) : undefined;
    if (!sub) {
      res
        .status(404)
        .json({ message: 'No active subscription to cancel', statusCode: 404 });
      return;
    }

    if (mode === 'immediate') {
      sub.status = 'canceled';
      sub.cancelAtPeriodEnd = false;
    } else {
      sub.cancelAtPeriodEnd = true;
    }
    sub.updatedAt = new Date().toISOString();
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
  const region = req.body?.region;
  if (region !== 'auto' && region !== 'ru' && region !== 'world') {
    res.status(400).json({
      message: 'region must be one of: auto, ru, world',
      statusCode: 400
    });
    return;
  }

  const customer = getOrCreateCustomer(user.id, user.locale);
  const newOverride = overrideForRegion(region);
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
    const customer = findCustomer(user.id);
    const sub = customer
      ? [...getState().billingSubscriptions.values()]
          .filter(
            (s) =>
              s.customerId === customer.id && ACTIVE_STATUSES.includes(s.status)
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
    const plan = sub
      ? [...getState().plans.values()].find((p) => p.key === sub.planKey)
      : undefined;
    // Plan capabilities unioned with active (non-revoked, non-expired)
    // one-time purchase grants — mirrors the server's EntitlementService.
    const now = Date.now();
    const granted = customer
      ? [...getState().billingCustomerGrants.values()].some(
          (grant) =>
            grant.customerId === customer.id &&
            grant.entitlement === 'reports' &&
            !grant.revokedAt &&
            (!grant.expiresAt || Date.parse(grant.expiresAt) > now)
        )
      : false;
    if (!plan?.entitlements.includes('reports') && !granted) {
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

billingAdminRouter.get(
  '/subscriptions',
  adminGuard,
  (_req: Request, res: Response) => {
    const subs = [...getState().billingSubscriptions.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toSubscriptionResponse);
    res.json(subs);
  }
);

billingAdminRouter.get(
  '/invoices',
  adminGuard,
  (_req: Request, res: Response) => {
    const invoices = [...getState().billingInvoices.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toInvoiceResponse);
    res.json(invoices);
  }
);

billingAdminRouter.post(
  '/subscriptions/:id/cancel',
  adminGuard,
  (req: Request, res: Response) => {
    const mode = req.body?.mode ?? 'period_end';
    if (mode !== 'period_end' && mode !== 'immediate') {
      res.status(400).json({
        message: 'mode must be one of: period_end, immediate',
        statusCode: 400
      });
      return;
    }

    const sub = getState().billingSubscriptions.get(
      (req.params['id'] as string) ?? ''
    );
    if (!sub) {
      res
        .status(404)
        .json({ message: 'Subscription not found', statusCode: 404 });
      return;
    }

    if (mode === 'immediate') {
      sub.status = 'canceled';
      sub.cancelAtPeriodEnd = false;
    } else {
      sub.cancelAtPeriodEnd = true;
    }
    sub.updatedAt = new Date().toISOString();
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
  (req: Request, res: Response) => {
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
    const amountMinor = req.body?.amountMinor;
    if (amountMinor !== undefined && !Number.isInteger(amountMinor)) {
      res.status(400).json({
        message:
          'Refund amount must be between 1 and the remaining refundable total',
        statusCode: 400
      });
      return;
    }

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
    res.json(toInvoiceResponse(invoice));
  }
);

// Metering ingest. Mirrors RecordUsageRequestDto validation, the
// active-subscription requirement, and idempotency on `idempotencyKey`. There is
// no public meter endpoint — this lives under the `manage Billing` admin guard.
const USAGE_ACTIVE_STATUSES = ['trialing', 'active', 'past_due'];

billingAdminRouter.post('/usage', adminGuard, (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const customerId =
    typeof body['customerId'] === 'string' ? body['customerId'].trim() : '';
  const meterKey =
    typeof body['meterKey'] === 'string' ? body['meterKey'].trim() : '';
  const quantity = body['quantity'];
  const idempotencyKey =
    typeof body['idempotencyKey'] === 'string'
      ? body['idempotencyKey'].trim()
      : '';
  const occurredAtRaw = body['occurredAt'];

  if (
    !customerId ||
    !meterKey ||
    meterKey.length > 100 ||
    !idempotencyKey ||
    idempotencyKey.length > 255 ||
    !Number.isInteger(quantity) ||
    (quantity as number) < 1 ||
    (occurredAtRaw !== undefined &&
      (typeof occurredAtRaw !== 'string' ||
        Number.isNaN(Date.parse(occurredAtRaw))))
  ) {
    res.status(400).json({ message: 'Invalid usage payload', statusCode: 400 });
    return;
  }

  const state = getState();

  // Idempotent replay: a record already exists for this key — return it as-is.
  const existing = [...state.billingUsageRecords.values()].find(
    (r) => r.idempotencyKey === idempotencyKey
  );
  if (existing) {
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

  const subscription = [...state.billingSubscriptions.values()].find(
    (s) =>
      s.customerId === customerId && USAGE_ACTIVE_STATUSES.includes(s.status)
  );
  if (!subscription) {
    res.status(404).json({
      message: 'No active subscription for customer to record usage against',
      statusCode: 404
    });
    return;
  }

  const now = new Date().toISOString();
  const record: MockUsageRecord = {
    id: uuidv4(),
    customerId,
    subscriptionId: subscription.id,
    meterKey,
    quantity: quantity as number,
    occurredAt:
      typeof occurredAtRaw === 'string'
        ? new Date(occurredAtRaw).toISOString()
        : now,
    idempotencyKey,
    recordedAt: now
  };
  state.billingUsageRecords.set(record.id, record);
  res.status(201).json(toUsageResponse(record));
});

export default router;
export { billingRouter, billingAdminRouter };
