import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';

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

async function login(email: string): Promise<{ token: string; id: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });

  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    tokens: { access_token: string };
    user: { id: string };
  };

  return { token: body.tokens.access_token, id: body.user.id };
}

async function control(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/__control/billing/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function activate(
  userId: string,
  planKey: string
): Promise<{ id: string; customerId: string }> {
  const res = await control('activate-subscription', { userId, planKey });

  expect(res.status).toBe(200);

  return (await res.json()) as { id: string; customerId: string };
}

async function listInvoices(
  token: string
): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${baseUrl}/api/v1/billing/invoices`, {
    headers: { authorization: `Bearer ${token}` }
  });

  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: Array<Record<string, unknown>>;
  };

  return body.data;
}

describe('POST /__control/billing/advance-renewal', () => {
  it('renews a fixed subscription at the plan price', async () => {
    const { token, id } = await login('user@example.com');

    await activate(id, 'pro');

    const before = await listInvoices(token);

    await control('advance-renewal', { userId: id });

    const invoices = await listInvoices(token);

    expect(invoices).toHaveLength(before.length + 1);
    // pro paddle price: $12.00.
    expect(
      invoices.filter(
        (i) => i['amountMinor'] === 1200 && i['status'] === 'paid'
      )
    ).not.toHaveLength(0);
  });

  it('lands the new boundary on the billing day, not on the clamped one', async () => {
    const { id } = await login('user@example.com');
    const { id: subscriptionId } = await activate(id, 'pro');
    const row = getState().billingSubscriptions.get(subscriptionId)!;

    row.billingAnchorAt = '2025-12-31T10:00:00.000Z';

    const res = await control('advance-renewal', { userId: id });

    expect(res.status).toBe(200);
    const advanced = (await res.json()) as Record<string, string>;

    // The advance anchors the new period at now, so the boundary falls in the
    // following month - on the 31st where that month has one, clamped where not.
    const start = new Date(advanced['currentPeriodStart']!);
    const daysInTargetMonth = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 2, 0)
    ).getUTCDate();

    expect(new Date(advanced['currentPeriodEnd']!).getUTCDate()).toBe(
      Math.min(31, daysInTargetMonth)
    );
    expect(row.billingAnchorAt).toBe('2025-12-31T10:00:00.000Z');
  });

  it('walks the dunning ladder on failures: past_due, then canceled after 3', async () => {
    const { id } = await login('user@example.com');

    await activate(id, 'pro');

    for (const expected of ['past_due', 'past_due', 'canceled']) {
      const res = await control('advance-renewal', {
        userId: id,
        outcome: 'failure'
      });

      expect(res.status).toBe(200);
      const sub = (await res.json()) as Record<string, unknown>;

      expect(sub['status']).toBe(expected);
    }
  });

  it('returns 404 when there is no subscription to advance', async () => {
    const { id } = await login('user@example.com');
    const res = await control('advance-renewal', { userId: id });

    expect(res.status).toBe(404);
  });

  it('advances a subscription addressed by id', async () => {
    const { id } = await login('user@example.com');
    const { id: subscriptionId } = await activate(id, 'pro');

    const res = await control('advance-renewal', { subscriptionId });

    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>)['status']).toBe(
      'active'
    );
  });

  it('refuses to advance a canceled subscription addressed by id', async () => {
    const { id } = await login('user@example.com');
    const { id: subscriptionId } = await activate(id, 'pro');

    // Three declined attempts exhaust the dunning ladder.
    for (let i = 0; i < 3; i++) {
      await control('advance-renewal', { subscriptionId, outcome: 'failure' });
    }

    expect(getState().billingSubscriptions.get(subscriptionId)?.status).toBe(
      'canceled'
    );

    const res = await control('advance-renewal', { subscriptionId });

    expect(res.status).toBe(404);
  });
});

describe('POST /__control/billing/renewal-notice', () => {
  function renewalNotices(userId: string) {
    return [...getState().userNotifications.values()].filter(
      (n) => n.userId === userId && n.kind === 'renewal_upcoming'
    );
  }

  async function activateSelfManaged(
    userId: string
  ): Promise<{ id: string; currentPeriodEnd: string }> {
    const res = await control('activate-subscription', {
      userId,
      planKey: 'pro',
      provider: 'yookassa'
    });

    expect(res.status).toBe(200);

    return (await res.json()) as { id: string; currentPeriodEnd: string };
  }

  it('stores one notice with the date and the amount, and none for the same boundary', async () => {
    const { id } = await login('user@example.com');
    const subscription = await activateSelfManaged(id);

    const first = await control('renewal-notice', { userId: id });
    const second = await control('renewal-notice', { userId: id });

    expect(await first.json()).toEqual({ sent: true });
    expect(await second.json()).toEqual({ sent: false });
    expect(renewalNotices(id).map(({ payload }) => payload)).toEqual([
      {
        subscriptionId: subscription.id,
        planName: 'Pro',
        renewsAt: subscription.currentPeriodEnd,
        amountMinor: 99000,
        currency: 'RUB'
      }
    ]);
  });

  it('stores a notice again for the boundary of the next period', async () => {
    const { id } = await login('user@example.com');

    await activateSelfManaged(id);
    await control('renewal-notice', { userId: id });
    await control('advance-renewal', { userId: id });
    await control('renewal-notice', { userId: id });

    expect(renewalNotices(id)).toHaveLength(2);
  });

  it.each([
    ['a provider-managed row', { provider: 'paddle' }],
    ['a row that does not renew', { cancelAtPeriodEnd: true }],
    ['a row in dunning', { status: 'past_due' }]
  ] as const)('stores nothing for %s', async (_name, change) => {
    const { id } = await login('user@example.com');
    const { id: subscriptionId } = await activateSelfManaged(id);
    const subscription = getState().billingSubscriptions.get(subscriptionId)!;

    if ('provider' in change) subscription.lifecycleOwner = 'provider';

    Object.assign(subscription, change);

    const res = await control('renewal-notice', { subscriptionId });

    expect(await res.json()).toEqual({ sent: false });
    expect(renewalNotices(id)).toHaveLength(0);
  });

  it('returns 404 when there is no subscription', async () => {
    const { id } = await login('user@example.com');
    const res = await control('renewal-notice', { userId: id });

    expect(res.status).toBe(404);
  });
});
