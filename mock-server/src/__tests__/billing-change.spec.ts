import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState, getState } from '../state';
import type { ProrationPreviewResponse } from '@app/shared/types';
import { ErrorKeys } from '@app/shared/constants';
import { mockId } from '../utils/mock-id';
import type { MockInvoice } from '../types';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  const app = createApp();
  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

// user@example.com has an English locale → paddle/USD in the mock's geo rules.
async function activateSubscription(planKey: string): Promise<string> {
  const res = await fetch(
    `${baseUrl}/__control/billing/activate-subscription`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: mockId('user-2'), planKey })
    }
  );
  expect(res.status).toBe(200);
  const sub = (await res.json()) as { id: string };
  return sub.id;
}

/** The ru locale routes user@example.com to YooKassa, a self-managed provider. */
function useRussianLocale(): void {
  const user = getState().users.get(mockId('user-2'));
  if (!user) throw new Error('user not seeded');
  user.locale = 'ru';
}

/** The paid invoice that the activation records for the period. */
function periodInvoice(subId: string): MockInvoice {
  const source = [...getState().billingInvoices.values()].find(
    (i) => i.subscriptionId === subId && i.status === 'paid'
  );
  if (!source) throw new Error('period invoice not seeded');
  return source;
}

function post(token: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

describe('POST /billing/subscription/change', () => {
  it('switches the plan, records the charge and refund invoices', async () => {
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');
    const source = periodInvoice(subId);

    const res = await post(token, 'subscription/change', {
      planKey: 'business'
    });
    expect(res.status).toBe(200);
    const sub = (await res.json()) as { planKey: string; billingMode: string };
    expect(sub.planKey).toBe('business');
    expect(sub.billingMode).toBe('fixed');

    const invoices = [...getState().billingInvoices.values()].filter(
      (i) => i.subscriptionId === subId && i.id !== source.id
    );
    const charge = invoices.find((i) => i.status === 'paid');
    const refund = invoices.find((i) => i.status === 'refunded');
    // A freshly-activated monthly period has its full remainder ahead, so the
    // legs equal the full plan prices (pro $12.00 back, business $29.00 due).
    expect(charge?.amountMinor).toBe(2900);
    expect(refund?.amountMinor).toBe(1200);
    // Paddle prorates on its side, and the server never flips the source.
    expect(source.status).toBe('paid');
  });

  it('marks a YooKassa source invoice refunded when the switch refunds all of it', async () => {
    useRussianLocale();
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');
    const source = periodInvoice(subId);
    expect(source.provider).toBe('yookassa');

    const res = await post(token, 'subscription/change', {
      planKey: 'business'
    });
    expect(res.status).toBe(200);

    // Refunded in full, so the admin console offers no second refund of it.
    expect(source.status).toBe('refunded');
    expect(source.refundedMinor).toBe(source.amountMinor);
  });

  it('keeps the source invoice paid when the switch refunds only part of it', async () => {
    useRussianLocale();
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');
    const source = periodInvoice(subId);
    const sub = getState().billingSubscriptions.get(subId);
    if (!sub) throw new Error('subscription not seeded');
    const day = 86_400_000;
    sub.currentPeriodStart = new Date(Date.now() - 15 * day).toISOString();
    sub.currentPeriodEnd = new Date(Date.now() + 15 * day).toISOString();

    const res = await post(token, 'subscription/change', {
      planKey: 'business'
    });
    expect(res.status).toBe(200);

    expect(source.status).toBe('paid');
    expect(source.refundedMinor).toBeGreaterThan(0);
    expect(source.refundedMinor).toBeLessThan(source.amountMinor);
  });

  it('switches fixed → usage with a refund and no charge', async () => {
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');

    const res = await post(token, 'subscription/change', { planKey: 'usage' });
    expect(res.status).toBe(200);
    const sub = (await res.json()) as { planKey: string; billingMode: string };
    expect(sub.billingMode).toBe('usage');

    const invoices = [...getState().billingInvoices.values()].filter(
      (i) => i.subscriptionId === subId
    );
    expect(invoices.some((i) => i.status === 'refunded')).toBe(true);
    // No new paid invoice beyond the activation one ($12.00).
    expect(
      invoices.filter((i) => i.status === 'paid' && i.amountMinor !== 1200)
    ).toHaveLength(0);
  });

  it('rejects switching to the current plan', async () => {
    const token = await login('user@example.com');
    await activateSubscription('pro');

    const res = await post(token, 'subscription/change', { planKey: 'pro' });
    expect(res.status).toBe(409);
  });

  it('404s without an active subscription', async () => {
    const token = await login('user@example.com');

    const res = await post(token, 'subscription/change', {
      planKey: 'business'
    });
    expect(res.status).toBe(404);
  });

  it('rejects a self-managed change after the period end, before any money moves', async () => {
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');
    const sub = getState().billingSubscriptions.get(subId);
    if (!sub) throw new Error('subscription not seeded');
    sub.lifecycleOwner = 'self';
    sub.currentPeriodEnd = new Date(Date.now() - 1000).toISOString();
    const invoicesBefore = getState().billingInvoices.size;

    for (const path of ['subscription/change', 'subscription/change/preview']) {
      const res = await post(token, path, { planKey: 'business' });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        message:
          'The billing period has ended and its renewal is in progress. Try again shortly.'
      });
    }
    expect(sub.planKey).toBe('pro');
    expect(getState().billingInvoices.size).toBe(invoicesBefore);
  });

  it('lets a provider-managed row change after its local period end', async () => {
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');
    const sub = getState().billingSubscriptions.get(subId);
    if (!sub) throw new Error('subscription not seeded');
    sub.currentPeriodEnd = new Date(Date.now() - 1000).toISOString();

    const res = await post(token, 'subscription/change', {
      planKey: 'business'
    });
    expect(res.status).toBe(200);
  });

  it('rejects a change while a cancellation is scheduled', async () => {
    const token = await login('user@example.com');
    await activateSubscription('pro');
    const cancel = await post(token, 'subscription/cancel', {});
    expect(cancel.status).toBe(200);

    const res = await post(token, 'subscription/change', {
      planKey: 'business'
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /billing/subscription/change - metered window', () => {
  const DAY_MS = 86_400_000;

  // Moves the period ten days back so the seeded units and the switch cannot
  // land on the same millisecond as the period start.
  function backdatePeriod(subId: string): void {
    const sub = getState().billingSubscriptions.get(subId);
    if (!sub) throw new Error('subscription not seeded');
    sub.currentPeriodStart = new Date(Date.now() - 10 * DAY_MS).toISOString();
  }

  async function seedUsage(subId: string): Promise<void> {
    const sub = getState().billingSubscriptions.get(subId);
    const res = await fetch(`${baseUrl}/__control/billing/seed-usage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: sub?.customerId,
        subscriptionId: subId,
        quantity: 100,
        occurredAt: new Date(Date.now() - 5 * DAY_MS).toISOString()
      })
    });
    expect(res.status).toBe(200);
  }

  function usageInvoices(subId: string) {
    return [...getState().billingInvoices.values()].filter(
      (i) => i.subscriptionId === subId && i.billingMode === 'usage'
    );
  }

  it('fixed → usage never rates the units consumed on the fixed plan', async () => {
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');
    backdatePeriod(subId);
    await seedUsage(subId);

    const res = await post(token, 'subscription/change', { planKey: 'usage' });
    expect(res.status).toBe(200);

    const usage = await fetch(`${baseUrl}/api/v1/billing/usage`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const summary = (await usage.json()) as {
      totalUnits: number;
      periodStart: string;
    };
    expect(summary.totalUnits).toBe(0);
    expect(summary.periodStart).toBe(
      getState().billingSubscriptions.get(subId)?.meteredFrom
    );

    const renewal = await fetch(
      `${baseUrl}/__control/billing/advance-renewal`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscriptionId: subId, outcome: 'success' })
      }
    );
    expect(renewal.status).toBe(200);
    const [closed] = usageInvoices(subId);
    expect(closed.amountMinor).toBe(0);
    expect(getState().billingSubscriptions.get(subId)?.meteredFrom).toBe(
      undefined
    );
  });

  it('usage → fixed bills the closing window under the usage plan', async () => {
    const token = await login('user@example.com');
    const subId = await activateSubscription('usage');
    backdatePeriod(subId);
    await seedUsage(subId);
    const before = new Set(usageInvoices(subId).map((i) => i.id));

    const res = await post(token, 'subscription/change', { planKey: 'pro' });
    expect(res.status).toBe(200);

    const added = usageInvoices(subId).filter((i) => !before.has(i.id));
    expect(added).toHaveLength(1);
    // 100 units at the Paddle unit price of 2 minor.
    expect(added[0]).toMatchObject({ amountMinor: 200, status: 'paid' });
  });
});

describe('POST /billing/subscription/change/preview', () => {
  it('returns the delegated net for a provider-managed subscription', async () => {
    const token = await login('user@example.com');
    await activateSubscription('pro');

    const res = await post(token, 'subscription/change/preview', {
      planKey: 'business'
    });
    expect(res.status).toBe(200);
    const preview = (await res.json()) as ProrationPreviewResponse;

    // Paddle (user locale en) delegates: net only, no split.
    expect(preview.provider).toBe('paddle');
    expect(preview.creditMinor).toBeNull();
    expect(preview.chargeMinor).toBeNull();
    expect(preview.dueNowMinor).toBe(2900 - 1200);
    expect(preview.currency).toBe('USD');
  });

  it('caps a self-managed credit by the unrefunded remainder, as the change does', async () => {
    const user = getState().users.get(mockId('user-2'));
    if (!user) throw new Error('user not seeded');
    user.locale = 'ru';
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');
    const source = [...getState().billingInvoices.values()].find(
      (i) => i.subscriptionId === subId && i.status === 'paid'
    );
    if (!source) throw new Error('period invoice not seeded');
    expect(source.amountMinor).toBe(99000);
    source.refundedMinor = 90000;

    const res = await post(token, 'subscription/change/preview', {
      planKey: 'business'
    });
    expect(res.status).toBe(200);
    const preview = (await res.json()) as ProrationPreviewResponse;

    expect(preview.provider).toBe('yookassa');
    expect(preview.creditMinor).toBe(9000);
    expect(preview.dueNowMinor).toBe((preview.chargeMinor ?? 0) - 9000);

    const change = await post(token, 'subscription/change', {
      planKey: 'business'
    });
    expect(change.status).toBe(200);
    const refund = [...getState().billingInvoices.values()].find(
      (i) =>
        i.subscriptionId === subId &&
        i.status === 'refunded' &&
        i.id !== source.id
    );
    expect(refund?.amountMinor).toBe(preview.creditMinor);
    // The earlier refund and this leg add up to the whole invoice.
    expect(source.status).toBe('refunded');
  });

  it('does not mutate the subscription or invoices', async () => {
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');
    const invoicesBefore = getState().billingInvoices.size;

    await post(token, 'subscription/change/preview', { planKey: 'business' });

    const sub = getState().billingSubscriptions.get(subId);
    expect(sub?.planKey).toBe('pro');
    expect(getState().billingInvoices.size).toBe(invoicesBefore);
  });
});

describe('a plan with no Paddle price id (server parity)', () => {
  const NO_PRICE_BODY = {
    statusCode: 503,
    message: 'Plan "business" has no Paddle price configured',
    error: 'Service Unavailable'
  };

  function removePaddlePriceId(planKey: string): void {
    const plan = [...getState().plans.values()].find((p) => p.key === planKey);
    if (!plan?.prices.paddle) throw new Error('plan not seeded');
    delete plan.prices.paddle.providerPriceId;
  }

  it('answers 503 on a Paddle checkout', async () => {
    const token = await login('user@example.com');
    removePaddlePriceId('business');

    const res = await post(token, 'checkout', { planKey: 'business' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(NO_PRICE_BODY);
  });

  it('answers 503 on a Paddle change and preview, with nothing changed', async () => {
    const token = await login('user@example.com');
    const subId = await activateSubscription('pro');
    removePaddlePriceId('business');
    const invoicesBefore = getState().billingInvoices.size;

    for (const path of ['subscription/change', 'subscription/change/preview']) {
      const res = await post(token, path, { planKey: 'business' });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual(NO_PRICE_BODY);
    }
    expect(getState().billingSubscriptions.get(subId)?.planKey).toBe('pro');
    expect(getState().billingInvoices.size).toBe(invoicesBefore);
  });

  it('leaves a YooKassa change unaffected', async () => {
    const token = await login('user@example.com');
    useRussianLocale();
    await activateSubscription('pro');
    removePaddlePriceId('business');

    const res = await post(token, 'subscription/change', {
      planKey: 'business'
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /billing/payment-method', () => {
  it('refuses the re-bind when the plan of the subscription is missing from the catalog', async () => {
    const token = await login('user@example.com');
    await activateSubscription('pro');
    const plans = getState().plans;
    for (const [id, plan] of plans) {
      if (plan.key === 'pro') plans.delete(id);
    }
    const methodsBefore = getState().billingPaymentMethods.size;

    const res = await post(token, 'payment-method', {});

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      message: 'The current plan is missing from the catalog',
      errorKey: ErrorKeys.BILLING.CURRENT_PLAN_MISSING,
      statusCode: 503
    });
    expect(getState().billingPaymentMethods.size).toBe(methodsBefore);
  });
});
