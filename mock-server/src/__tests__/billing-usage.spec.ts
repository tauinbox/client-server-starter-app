import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import type { MeteringResponse } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';
import * as sseHub from '../sse-hub';

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

/**
 * A subscription on `planKey` for the user with `email`, with the given
 * status; a `canceled` one leaves a customer with no entitled subscription.
 */
async function activateSubscription(
  email: string,
  { planKey = 'pro', status = 'active' }: { planKey?: string; status?: string }
): Promise<{ customerId: string; userId: string }> {
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  const me = (await loginRes.json()) as { user: { id: string } };
  const res = await fetch(
    `${baseUrl}/__control/billing/activate-subscription`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: me.user.id, planKey, status })
    }
  );

  expect(res.status).toBe(200);
  const sub = (await res.json()) as { customerId: string };

  return { customerId: sub.customerId, userId: me.user.id };
}

/** A customer of `email` with no entitled subscription and `units` credits. */
async function fundedCustomer(
  email: string,
  units: number
): Promise<{ customerId: string; userId: string }> {
  const ids = await activateSubscription(email, { status: 'canceled' });

  getState().billingCreditBalances.set(ids.customerId, {
    customerId: ids.customerId,
    balanceUnits: units,
    updatedAt: new Date().toISOString()
  });

  return ids;
}

function balanceOf(customerId: string): number | undefined {
  return getState().billingCreditBalances.get(customerId)?.balanceUnits;
}

function use(customerId: string, overrides: Record<string, unknown> = {}) {
  return {
    customerId,
    meterKey: 'api_calls',
    quantity: 3,
    idempotencyKey: 'evt-1',
    ...overrides
  };
}

function getUsage(token?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing/usage`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

describe('GET /api/v1/billing/usage parity with server', () => {
  it('rejects unauthenticated calls (401)', async () => {
    const res = await getUsage();

    expect(res.status).toBe(401);
  });

  it('returns null when the caller has no billing customer', async () => {
    const token = await login('user@example.com');
    const res = await getUsage(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('reports the units that metered uses took this month', async () => {
    const admin = await login('admin@example.com');
    const { customerId } = await fundedCustomer('user@example.com', 50);

    await postUsage(admin, use(customerId, { quantity: 7 }));
    await postUsage(
      admin,
      use(customerId, { quantity: 5, idempotencyKey: 'evt-2' })
    );

    const res = await getUsage(await login('user@example.com'));

    expect(await res.json()).toMatchObject({ unitsSpent: 12 });
  });
});

describe('POST /api/v1/admin/billing/usage parity with server', () => {
  it('debits the units at once and stores a record with no subscription', async () => {
    const token = await login('admin@example.com');
    const { customerId } = await fundedCustomer('user@example.com', 10);

    const res = await postUsage(token, use(customerId));

    expect(res.status).toBe(201);
    const body = (await res.json()) as MeteringResponse;

    expect(body).toEqual({
      recordId: expect.any(String) as string,
      debited: true,
      replayed: false,
      balanceAfter: 7
    });
    expect(balanceOf(customerId)).toBe(7);
    expect(
      getState().billingUsageRecords.get(body.recordId as string)
    ).toMatchObject({ subscriptionId: null, quantity: 3 });
  });

  it('is idempotent: a replayed key answers the first record and debits once', async () => {
    const token = await login('admin@example.com');
    const { customerId } = await fundedCustomer('user@example.com', 10);

    const first = (await (
      await postUsage(token, use(customerId))
    ).json()) as MeteringResponse;
    const replay = await postUsage(token, use(customerId));

    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual({
      recordId: first.recordId,
      debited: true,
      replayed: true,
      balanceAfter: 7
    });
    expect(balanceOf(customerId)).toBe(7);
    expect(getState().billingUsageRecords.size).toBe(1);
  });

  it('refuses the same key with another quantity (409)', async () => {
    const token = await login('admin@example.com');
    const { customerId } = await fundedCustomer('user@example.com', 10);

    await postUsage(token, use(customerId));
    const res = await postUsage(token, use(customerId, { quantity: 4 }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.BILLING.USAGE_KEY_REUSED
    });
    expect(balanceOf(customerId)).toBe(7);
  });

  it('scopes idempotency to the customer: the same key from another customer is a separate use', async () => {
    const token = await login('admin@example.com');
    const a = await fundedCustomer('user@example.com', 10);
    const b = await fundedCustomer('admin@example.com', 10);

    await postUsage(token, use(a.customerId));
    const res = await postUsage(token, use(b.customerId));

    expect(await res.json()).toMatchObject({ replayed: false });
    expect(balanceOf(b.customerId)).toBe(7);
  });

  it.each([
    ['fewer units than the use', 2],
    ['a clawed-back debt', -50]
  ])('refuses a use with %s (409) and writes nothing', async (_name, units) => {
    const token = await login('admin@example.com');
    const { customerId } = await fundedCustomer('user@example.com', units);

    const res = await postUsage(token, use(customerId));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.BILLING.INSUFFICIENT_CREDITS
    });
    expect(balanceOf(customerId)).toBe(units);
    expect(getState().billingUsageRecords.size).toBe(0);
  });

  it('refuses a customer that never bought credits (409)', async () => {
    const token = await login('admin@example.com');

    const res = await postUsage(token, use(mockId('no-such-customer')));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.BILLING.INSUFFICIENT_CREDITS
    });
  });

  it('does not debit a subscriber whose plan has the capability of the meter', async () => {
    const token = await login('admin@example.com');
    const { customerId } = await activateSubscription('user@example.com', {
      planKey: 'pro'
    });

    const res = await postUsage(token, use(customerId));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      recordId: null,
      debited: false,
      replayed: false,
      balanceAfter: 0
    });
    expect(getState().billingUsageRecords.size).toBe(0);
  });

  it('tells the owner once when a debit takes the balance to 0', async () => {
    const token = await login('admin@example.com');
    const { customerId, userId } = await fundedCustomer('user@example.com', 6);
    const push = jest.spyOn(sseHub, 'pushToUser');

    await postUsage(token, use(customerId));
    expect(push).not.toHaveBeenCalled();

    await postUsage(token, use(customerId, { idempotencyKey: 'evt-2' }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(userId, {
      type: 'entitlements_updated'
    });
    push.mockRestore();
  });

  it('rejects a meter outside the meter catalog (422)', async () => {
    const token = await login('admin@example.com');
    const { customerId } = await fundedCustomer('user@example.com', 10);

    const res = await postUsage(
      token,
      use(customerId, { meterKey: 'typo_calls' })
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.BILLING.METER_NOT_DECLARED
    });
    expect(balanceOf(customerId)).toBe(10);
  });

  it('rejects an occurredAt past the clock skew tolerance (422)', async () => {
    const token = await login('admin@example.com');
    const { customerId } = await fundedCustomer('user@example.com', 10);

    const res = await postUsage(
      token,
      use(customerId, {
        occurredAt: new Date(Date.now() + 6 * 60_000).toISOString()
      })
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.BILLING.USAGE_IN_FUTURE
    });
  });

  it('accepts an occurredAt inside the clock skew tolerance', async () => {
    const token = await login('admin@example.com');
    const { customerId } = await fundedCustomer('user@example.com', 10);

    const res = await postUsage(
      token,
      use(customerId, {
        occurredAt: new Date(Date.now() + 60_000).toISOString()
      })
    );

    expect(res.status).toBe(201);
  });

  it('rejects an invalid payload (422)', async () => {
    const token = await login('admin@example.com');
    const { customerId } = await fundedCustomer('user@example.com', 10);

    const res = await postUsage(token, {
      customerId,
      meterKey: '',
      quantity: 0,
      idempotencyKey: ''
    });

    expect(res.status).toBe(422);
  });

  it('denies a non-admin caller (403)', async () => {
    const token = await login('user@example.com');

    const res = await postUsage(token, use(mockId('no-such-customer')));

    expect(res.status).toBe(403);
  });
});
