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

async function activate(userId: string): Promise<{ customerId: string }> {
  const res = await fetch(
    `${baseUrl}/__control/billing/activate-subscription`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, planKey: 'pro' })
    }
  );

  expect(res.status).toBe(200);

  return (await res.json()) as { customerId: string };
}

function usage(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing/usage`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

function storeRecord(
  customerId: string,
  { quantity, recordedAt = new Date() }: { quantity: number; recordedAt?: Date }
): void {
  const id = `use-${getState().billingUsageRecords.size}`;

  getState().billingUsageRecords.set(id, {
    id,
    customerId,
    subscriptionId: null,
    meterKey: 'api_calls',
    quantity,
    occurredAt: recordedAt.toISOString(),
    idempotencyKey: id,
    recordedAt: recordedAt.toISOString()
  });
}

describe('the usage summary', () => {
  it('reports the credit units that metered uses took this calendar month', async () => {
    const { token, id } = await login('user@example.com');
    const { customerId } = await activate(id);
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );

    storeRecord(customerId, { quantity: 40 });
    storeRecord(customerId, { quantity: 2 });
    // A debit of an earlier month does not count.
    storeRecord(customerId, {
      quantity: 500,
      recordedAt: new Date(monthStart.getTime() - 1)
    });

    expect(await (await usage(token)).json()).toEqual({
      periodStart: monthStart.toISOString(),
      periodEnd: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
      ).toISOString(),
      unitsSpent: 42
    });
  });

  it('is null for a caller with no billing customer', async () => {
    const { token } = await login('user@example.com');
    const res = await usage(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
