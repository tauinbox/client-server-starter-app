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

// Activates a subscription for the admin user so a customer with an active
// subscription exists, and returns its customer id.
async function seedActiveCustomer(): Promise<string> {
  const admin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  const me = (await admin.json()) as { user: { id: string } };
  const res = await fetch(
    `${baseUrl}/__control/billing/activate-subscription`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: me.user.id, planKey: 'pro' })
    }
  );
  expect(res.status).toBe(200);
  const sub = (await res.json()) as { customerId: string };
  return sub.customerId;
}

function postUsage(token: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/admin/billing/usage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

describe('POST /api/v1/admin/billing/usage parity with server', () => {
  it('records usage and never serializes the idempotency key', async () => {
    const token = await login('admin@example.com');
    const customerId = await seedActiveCustomer();

    const res = await postUsage(token, {
      customerId,
      meterKey: 'api_calls',
      quantity: 42,
      idempotencyKey: 'evt-1'
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['quantity']).toBe(42);
    expect(body['meterKey']).toBe('api_calls');
    expect(body).not.toHaveProperty('idempotencyKey');
  });

  it('is idempotent: a replayed key returns the original record', async () => {
    const token = await login('admin@example.com');
    const customerId = await seedActiveCustomer();
    const payload = {
      customerId,
      meterKey: 'api_calls',
      quantity: 10,
      idempotencyKey: 'evt-dup'
    };

    const first = (await (await postUsage(token, payload)).json()) as {
      id: string;
    };
    const second = (await (
      await postUsage(token, { ...payload, quantity: 999 })
    ).json()) as { id: string; quantity: number };

    expect(second.id).toBe(first.id);
    // The replay returns the original quantity, not the second call's value.
    expect(second.quantity).toBe(10);
  });

  it('returns 404 when the customer has no active subscription', async () => {
    const token = await login('admin@example.com');

    const res = await postUsage(token, {
      customerId: '11111111-1111-1111-1111-111111111111',
      meterKey: 'api_calls',
      quantity: 1,
      idempotencyKey: 'evt-x'
    });

    expect(res.status).toBe(404);
  });

  it('rejects an invalid payload (400)', async () => {
    const token = await login('admin@example.com');
    const customerId = await seedActiveCustomer();

    const res = await postUsage(token, {
      customerId,
      meterKey: '',
      quantity: 0,
      idempotencyKey: ''
    });

    expect(res.status).toBe(400);
  });

  it('denies a non-admin caller (403)', async () => {
    const token = await login('user@example.com');

    const res = await postUsage(token, {
      customerId: '11111111-1111-1111-1111-111111111111',
      meterKey: 'api_calls',
      quantity: 1,
      idempotencyKey: 'evt-y'
    });

    expect(res.status).toBe(403);
  });
});
