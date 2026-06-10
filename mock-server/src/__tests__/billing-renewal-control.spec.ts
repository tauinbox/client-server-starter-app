import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../app';
import { resetState } from '../state';

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
  return (await res.json()) as Array<Record<string, unknown>>;
}

describe('POST /__control/billing/advance-renewal', () => {
  it('closes a usage period postpaid: invoice covers the closed period at overage pricing', async () => {
    const { token, id } = await login('user@example.com');
    const { customerId } = await activate(id, 'usage');
    await control('seed-usage', { customerId, quantity: 30 });
    await control('seed-usage', { customerId, quantity: 12 });
    // Outside the current period — must not be billed.
    await control('seed-usage', {
      customerId,
      quantity: 999,
      occurredAt: '2000-01-01T00:00:00.000Z'
    });

    const before = await listInvoices(token);
    const res = await control('advance-renewal', { userId: id });
    expect(res.status).toBe(200);
    const sub = (await res.json()) as Record<string, unknown>;
    expect(sub['status']).toBe('active');

    const invoices = await listInvoices(token);
    expect(invoices).toHaveLength(before.length + 1);
    // user@example.com is non-RU → paddle price: $0.02/unit, 0 included.
    const usageInvoice = invoices.find((i) => i['amountMinor'] === 84);
    expect(usageInvoice).toMatchObject({
      billingMode: 'usage',
      status: 'paid',
      currency: 'USD'
    });
    // Postpaid: the invoice's period ends where the new subscription period begins.
    expect(usageInvoice!['periodEnd']).toBe(sub['currentPeriodStart']);
  });

  it('closes a zero-usage period with a zero invoice and still advances', async () => {
    const { token, id } = await login('user@example.com');
    await activate(id, 'usage');

    const before = await listInvoices(token);
    const res = await control('advance-renewal', { userId: id });
    expect(res.status).toBe(200);

    const invoices = await listInvoices(token);
    expect(invoices).toHaveLength(before.length + 1);
    expect(
      invoices.some(
        (i) =>
          i['amountMinor'] === 0 &&
          i['billingMode'] === 'usage' &&
          i['status'] === 'paid'
      )
    ).toBe(true);
  });

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

  it('walks the dunning ladder on failures: past_due, then canceled after 3', async () => {
    const { id } = await login('user@example.com');
    await activate(id, 'usage');

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
});
