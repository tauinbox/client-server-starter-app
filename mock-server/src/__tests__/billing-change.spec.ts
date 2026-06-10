import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../app';
import { resetState, getState } from '../state';
import type { ProrationPreviewResponse } from '@app/shared/types';

let server: Server;
let baseUrl: string;

beforeAll((done) => {
  resetState();
  const app = createApp();
  server = app.listen(0, () => {
    const addr = server.address() as AddressInfo;
    baseUrl = `http://localhost:${addr.port}`;
    done();
  });
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
      body: JSON.stringify({ userId: '2', planKey })
    }
  );
  expect(res.status).toBe(200);
  const sub = (await res.json()) as { id: string };
  return sub.id;
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

    const res = await post(token, 'subscription/change', {
      planKey: 'business'
    });
    expect(res.status).toBe(200);
    const sub = (await res.json()) as { planKey: string; billingMode: string };
    expect(sub.planKey).toBe('business');
    expect(sub.billingMode).toBe('fixed');

    const invoices = [...getState().billingInvoices.values()].filter(
      (i) => i.subscriptionId === subId
    );
    const charge = invoices.find(
      (i) => i.status === 'paid' && i.amountMinor > 0 && i.amountMinor !== 1200
    );
    const refund = invoices.find((i) => i.status === 'refunded');
    // A freshly-activated monthly period has its full remainder ahead, so the
    // legs equal the full plan prices (pro $12.00 back, business $29.00 due).
    expect(charge?.amountMinor).toBe(2900);
    expect(refund?.amountMinor).toBe(1200);
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
