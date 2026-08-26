import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
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

async function activate(
  userId: string,
  planKey: string
): Promise<{ id: string; customerId: string }> {
  const res = await fetch(
    `${baseUrl}/__control/billing/activate-subscription`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, planKey })
    }
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; customerId: string };
}

async function seedUsage(customerId: string, quantity: number): Promise<void> {
  const res = await fetch(`${baseUrl}/__control/billing/seed-usage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId, quantity })
  });
  expect(res.status).toBe(200);
}

function cancel(token: string, mode?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing/subscription/cancel`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(mode ? { mode } : {})
  });
}

function invoicesOf(subscriptionId: string): MockInvoice[] {
  return [...getState().billingInvoices.values()].filter(
    (i) => i.subscriptionId === subscriptionId
  );
}

/**
 * Activation seeds its own paid invoice, so a cancellation's effect is only
 * visible as the rows that were not there before it ran.
 */
function invoicesAddedSince(
  subscriptionId: string,
  before: MockInvoice[]
): MockInvoice[] {
  const seen = new Set(before.map((i) => i.id));
  return invoicesOf(subscriptionId).filter((i) => !seen.has(i.id));
}

/**
 * A self-managed (YooKassa) customer is what the closing charge applies to;
 * the mock derives the provider from the user's locale, as the server derives
 * it from the detected country.
 */
async function selfManagedUsageSub(): Promise<{
  token: string;
  subscriptionId: string;
  customerId: string;
}> {
  const { token, id } = await login('user@example.com');
  const user = getState().users.get(id);
  expect(user).toBeDefined();
  if (user) user.locale = 'ru';
  const sub = await activate(id, 'usage');
  expect(getState().billingSubscriptions.get(sub.id)?.lifecycleOwner).toBe(
    'self'
  );
  return { token, subscriptionId: sub.id, customerId: sub.customerId };
}

describe('cancelling a usage subscription bills the period it closes', () => {
  it('invoices the metered period on an immediate cancel', async () => {
    const { token, subscriptionId, customerId } = await selfManagedUsageSub();
    await seedUsage(customerId, 42);
    const before = invoicesOf(subscriptionId);

    const res = await cancel(token, 'immediate');
    expect(res.status).toBe(200);

    const invoices = invoicesAddedSince(subscriptionId, before);
    expect(invoices).toHaveLength(1);
    // 42 units × 200 minor (RUB usage price, no included units).
    expect(invoices[0]).toMatchObject({
      amountMinor: 8400,
      currency: 'RUB',
      status: 'paid',
      billingMode: 'usage'
    });
    expect(getState().billingSubscriptions.get(subscriptionId)?.status).toBe(
      'canceled'
    );
  });

  it('spends prepaid credits against the closing period', async () => {
    const { token, subscriptionId, customerId } = await selfManagedUsageSub();
    await seedUsage(customerId, 42);
    getState().billingCreditBalances.set(customerId, {
      customerId,
      balanceUnits: 10,
      updatedAt: new Date().toISOString()
    });
    const before = invoicesOf(subscriptionId);

    await cancel(token, 'immediate');

    const invoice = invoicesAddedSince(subscriptionId, before)[0];
    // 42 billable − 10 credits = 32 × 200 minor.
    expect(invoice?.amountMinor).toBe(6400);
    expect(getState().billingCreditBalances.get(customerId)?.balanceUnits).toBe(
      0
    );
  });

  it('leaves a period-end cancel to the boundary, which then invoices and cancels', async () => {
    const { token, subscriptionId, customerId } = await selfManagedUsageSub();
    await seedUsage(customerId, 42);

    const before = invoicesOf(subscriptionId);
    const res = await cancel(token);
    expect(res.status).toBe(200);
    expect(invoicesAddedSince(subscriptionId, before)).toHaveLength(0);

    const renewal = await fetch(
      `${baseUrl}/__control/billing/advance-renewal`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscriptionId, outcome: 'success' })
      }
    );
    expect(renewal.status).toBe(200);

    const invoices = invoicesAddedSince(subscriptionId, before);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ amountMinor: 8400, status: 'paid' });
    const sub = getState().billingSubscriptions.get(subscriptionId);
    expect(sub?.status).toBe('canceled');
    // The period must not advance past the one just billed.
    expect(sub?.currentPeriodStart).toBe(invoices[0].periodStart);
  });

  it('invoices nothing when a fixed subscription is cancelled', async () => {
    const { token, id } = await login('user@example.com');
    const sub = await activate(id, 'pro');
    const before = invoicesOf(sub.id);

    await cancel(token, 'immediate');

    expect(invoicesAddedSince(sub.id, before)).toEqual([]);
  });

  it('leaves a provider-managed subscription to its cancel webhook', async () => {
    const { token, id } = await login('user@example.com');
    const sub = await activate(id, 'usage');
    expect(getState().billingSubscriptions.get(sub.id)?.lifecycleOwner).toBe(
      'provider'
    );
    await seedUsage(sub.customerId, 42);
    const before = invoicesOf(sub.id);

    await cancel(token, 'immediate');

    expect(invoicesAddedSince(sub.id, before)).toEqual([]);
  });
});
