import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  BillingProviderId,
  BillingRegion,
  PlanResponse
} from '@app/shared/types';
import {
  getState,
  toInvoiceResponse,
  toPaymentMethodResponse,
  toPlanResponse,
  toSubscriptionResponse
} from '../state';
import { authGuard } from '../helpers/auth.helpers';
import type {
  AuthenticatedRequest,
  MockCustomer,
  MockSubscription
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

// Mock treats both providers as configured (design §18.5), so lifecycle
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
    if (!plan?.entitlements.includes('reports')) {
      res.status(403).json({
        message: 'This action requires the "reports" entitlement',
        statusCode: 403
      });
      return;
    }
    res.json({ available: true });
  }
);

export default router;
export { billingRouter };
