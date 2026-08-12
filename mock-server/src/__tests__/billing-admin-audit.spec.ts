import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockAuditLog } from '../types';

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

async function loginAdmin(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    user: { id: string };
    tokens: { access_token: string };
  };
  return { token: body.tokens.access_token, userId: body.user.id };
}

async function activateSubscription(
  userId: string
): Promise<{ subscriptionId: string; customerId: string }> {
  const res = await fetch(
    `${baseUrl}/__control/billing/activate-subscription`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, planKey: 'pro' })
    }
  );
  expect(res.status).toBe(200);
  const sub = (await res.json()) as { id: string; customerId: string };
  return { subscriptionId: sub.id, customerId: sub.customerId };
}

function post(token: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body ?? {})
  });
}

function entriesFor(action: string): MockAuditLog[] {
  return getState().auditLogs.filter((e) => e.action === action);
}

describe('admin billing mutations write audit entries', () => {
  it('audits a cancellation with its mode', async () => {
    const { token, userId } = await loginAdmin();
    const { subscriptionId } = await activateSubscription(userId);

    const res = await post(
      token,
      `/admin/billing/subscriptions/${subscriptionId}/cancel`,
      { mode: 'immediate' }
    );
    expect(res.status).toBe(200);

    const entries = entriesFor('BILLING_SUBSCRIPTION_CANCEL');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: userId,
      actorEmail: 'admin@example.com',
      targetId: subscriptionId,
      targetType: 'Subscription',
      details: { mode: 'immediate' }
    });
  });

  it('defaults the audited cancel mode like the DTO does', async () => {
    const { token, userId } = await loginAdmin();
    const { subscriptionId } = await activateSubscription(userId);

    await post(
      token,
      `/admin/billing/subscriptions/${subscriptionId}/cancel`,
      {}
    );

    expect(entriesFor('BILLING_SUBSCRIPTION_CANCEL')[0]?.details).toEqual({
      mode: 'period_end'
    });
  });

  it('refuses a second cancel and writes no second audit entry', async () => {
    const { token, userId } = await loginAdmin();
    const { subscriptionId } = await activateSubscription(userId);
    const path = `/admin/billing/subscriptions/${subscriptionId}/cancel`;

    expect((await post(token, path, { mode: 'immediate' })).status).toBe(200);

    const repeat = await post(token, path, { mode: 'immediate' });
    expect(repeat.status).toBe(409);

    // A period-end repeat must not flag a canceled row either.
    const periodEnd = await post(token, path, { mode: 'period_end' });
    expect(periodEnd.status).toBe(409);
    expect(
      getState().billingSubscriptions.get(subscriptionId)?.cancelAtPeriodEnd
    ).toBe(false);

    expect(entriesFor('BILLING_SUBSCRIPTION_CANCEL')).toHaveLength(1);
  });

  it('audits a refund with the requested amount', async () => {
    const { token, userId } = await loginAdmin();
    const { customerId } = await activateSubscription(userId);
    const invoice = [...getState().billingInvoices.values()].find(
      (i) => i.customerId === customerId
    );
    expect(invoice).toBeDefined();

    const res = await post(
      token,
      `/admin/billing/invoices/${invoice?.id}/refund`,
      { amountMinor: 100 }
    );
    expect(res.status).toBe(200);

    const entries = entriesFor('BILLING_INVOICE_REFUND');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      targetId: invoice?.id,
      targetType: 'Invoice',
      details: { amountMinor: 100 }
    });
  });

  it('audits a full refund with a null amount', async () => {
    const { token, userId } = await loginAdmin();
    const { customerId } = await activateSubscription(userId);
    const invoice = [...getState().billingInvoices.values()].find(
      (i) => i.customerId === customerId
    );

    await post(token, `/admin/billing/invoices/${invoice?.id}/refund`, {});

    expect(entriesFor('BILLING_INVOICE_REFUND')[0]?.details).toEqual({
      amountMinor: null
    });
  });

  it('audits recorded usage, including an idempotent replay', async () => {
    const { token, userId } = await loginAdmin();
    const { customerId } = await activateSubscription(userId);
    const payload = {
      customerId,
      meterKey: 'api_calls',
      quantity: 42,
      idempotencyKey: 'evt-audit-1'
    };

    const first = await post(token, '/admin/billing/usage', payload);
    expect(first.status).toBe(201);
    const record = (await first.json()) as { id: string };

    const replay = await post(token, '/admin/billing/usage', payload);
    expect(replay.status).toBe(201);

    const entries = entriesFor('BILLING_USAGE_RECORD');
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        targetId: record.id,
        targetType: 'UsageRecord',
        details: { customerId, meterKey: 'api_calls', quantity: 42 }
      });
    }
  });

  it('never audits the usage idempotency key', async () => {
    const { token, userId } = await loginAdmin();
    const { customerId } = await activateSubscription(userId);

    await post(token, '/admin/billing/usage', {
      customerId,
      meterKey: 'api_calls',
      quantity: 1,
      idempotencyKey: 'evt-audit-2'
    });

    expect(entriesFor('BILLING_USAGE_RECORD')[0]?.details).not.toHaveProperty(
      'idempotencyKey'
    );
  });

  it('leaves no entry when the mutation fails', async () => {
    const { token } = await loginAdmin();
    const unknownId = '123e4567-e89b-12d3-a456-426614174000';

    const cancel = await post(
      token,
      `/admin/billing/subscriptions/${unknownId}/cancel`,
      {}
    );
    expect(cancel.status).toBe(404);

    const usage = await post(token, '/admin/billing/usage', {
      customerId: unknownId,
      meterKey: 'api_calls',
      quantity: 1,
      idempotencyKey: 'evt-audit-3'
    });
    expect(usage.status).toBe(404);

    expect(entriesFor('BILLING_SUBSCRIPTION_CANCEL')).toHaveLength(0);
    expect(entriesFor('BILLING_USAGE_RECORD')).toHaveLength(0);
  });
});
