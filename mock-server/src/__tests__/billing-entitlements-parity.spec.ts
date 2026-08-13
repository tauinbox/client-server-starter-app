// Parity coverage for GET /billing/entitlements: the four resolution rules a
// client deriving capabilities from the plan catalog would get wrong - purchased
// grants, grant expiry, the Free fallback, and the past_due grace window.

import type { Server } from 'http';
import type { EntitlementsResponse } from '@app/shared/types';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants/auth.constants';
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

async function login(email = 'user@example.com'): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

function getEntitlements(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing/entitlements`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

async function readEntitlements(token: string): Promise<EntitlementsResponse> {
  const res = await getEntitlements(token);
  expect(res.status).toBe(200);
  return (await res.json()) as EntitlementsResponse;
}

function activateSubscription(
  userId: string,
  planKey: string,
  status = 'active'
): Promise<Response> {
  return fetch(`${baseUrl}/__control/billing/activate-subscription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, planKey, status })
  });
}

function currentUserId(): string {
  const user = [...getState().users.values()].find(
    (u) => u.email === 'user@example.com'
  );
  expect(user).toBeDefined();
  return user!.id;
}

function customerIdOf(userId: string): string {
  const customer = [...getState().billingCustomers.values()].find(
    (c) => c.userId === userId
  );
  expect(customer).toBeDefined();
  return customer!.id;
}

describe('GET /billing/entitlements', () => {
  it('requires auth', async () => {
    const res = await fetch(`${baseUrl}/api/v1/billing/entitlements`);
    expect(res.status).toBe(401);
  });

  it('falls back to the Free tier for a user with no billing customer', async () => {
    const token = await login();
    await expect(readEntitlements(token)).resolves.toEqual({
      planKey: 'free',
      capabilities: [],
      limits: {}
    });
  });

  it('returns the plan capabilities and limits for an active subscription', async () => {
    const token = await login();
    expect((await activateSubscription(currentUserId(), 'pro')).status).toBe(
      200
    );

    await expect(readEntitlements(token)).resolves.toEqual({
      planKey: 'pro',
      capabilities: ['reports', 'api-access', 'data-export'],
      limits: { sessions: 10 }
    });
  });

  it('keeps full entitlements through the past_due grace window', async () => {
    const token = await login();
    expect(
      (await activateSubscription(currentUserId(), 'pro', 'past_due')).status
    ).toBe(200);

    const resolved = await readEntitlements(token);
    expect(resolved.planKey).toBe('pro');
    expect(resolved.capabilities).toContain('reports');
  });

  it('drops to Free once the subscription is canceled', async () => {
    const token = await login();
    const userId = currentUserId();
    expect((await activateSubscription(userId, 'pro')).status).toBe(200);

    for (const sub of getState().billingSubscriptions.values()) {
      sub.status = 'canceled';
    }

    await expect(readEntitlements(token)).resolves.toEqual({
      planKey: 'free',
      capabilities: [],
      limits: {}
    });
  });

  it('unions an active one-time grant on top of the Free tier', async () => {
    const token = await login();
    const userId = currentUserId();
    expect((await activateSubscription(userId, 'pro')).status).toBe(200);
    const customerId = customerIdOf(userId);
    for (const sub of getState().billingSubscriptions.values()) {
      sub.status = 'canceled';
    }
    getState().billingCustomerGrants.set('grant-1', {
      id: 'grant-1',
      customerId,
      entitlement: 'reports',
      sourceInvoiceId: 'inv-1',
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString()
    });

    const resolved = await readEntitlements(token);
    expect(resolved.planKey).toBe('free');
    expect(resolved.capabilities).toEqual(['reports']);
  });

  it('deduplicates a grant the plan already carries', async () => {
    const token = await login();
    const userId = currentUserId();
    expect((await activateSubscription(userId, 'pro')).status).toBe(200);
    getState().billingCustomerGrants.set('grant-2', {
      id: 'grant-2',
      customerId: customerIdOf(userId),
      entitlement: 'reports',
      sourceInvoiceId: 'inv-2',
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString()
    });

    const resolved = await readEntitlements(token);
    expect(resolved.capabilities).toEqual([
      'reports',
      'api-access',
      'data-export'
    ]);
  });

  it('ignores expired and revoked grants', async () => {
    const token = await login();
    const userId = currentUserId();
    expect((await activateSubscription(userId, 'pro')).status).toBe(200);
    const customerId = customerIdOf(userId);
    for (const sub of getState().billingSubscriptions.values()) {
      sub.status = 'canceled';
    }
    getState().billingCustomerGrants.set('grant-expired', {
      id: 'grant-expired',
      customerId,
      entitlement: 'reports',
      sourceInvoiceId: 'inv-3',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString()
    });
    getState().billingCustomerGrants.set('grant-revoked', {
      id: 'grant-revoked',
      customerId,
      entitlement: 'data-export',
      sourceInvoiceId: 'inv-4',
      expiresAt: null,
      revokedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    await expect(readEntitlements(token)).resolves.toEqual({
      planKey: 'free',
      capabilities: [],
      limits: {}
    });
  });

  it('is scoped to the caller - another user sees their own resolution', async () => {
    const userToken = await login();
    const adminToken = await login('admin@example.com');
    expect((await activateSubscription(currentUserId(), 'pro')).status).toBe(
      200
    );

    await expect(readEntitlements(userToken)).resolves.toMatchObject({
      planKey: 'pro'
    });
    await expect(readEntitlements(adminToken)).resolves.toEqual({
      planKey: 'free',
      capabilities: [],
      limits: {}
    });
  });
});

describe('the concurrent-session allowance is plan-driven', () => {
  function tokensHeldBy(userId: string): number {
    let held = 0;
    for (const uid of getState().refreshTokens.values()) {
      if (uid === userId) held++;
    }
    return held;
  }

  it('trims to MAX_CONCURRENT_SESSIONS for a plan carrying no sessions limit', async () => {
    for (let i = 0; i < MAX_CONCURRENT_SESSIONS + 3; i++) await login();

    expect(tokensHeldBy(currentUserId())).toBe(MAX_CONCURRENT_SESSIONS);
  });

  it('keeps the raised allowance once the plan carries one', async () => {
    await login();
    expect((await activateSubscription(currentUserId(), 'pro')).status).toBe(
      200
    );

    // Pro seeds `{ sessions: 10 }`, so sign-ins past the constant must survive.
    for (let i = 0; i < 9; i++) await login();

    expect(tokensHeldBy(currentUserId())).toBe(10);
  });

  it('evicts rather than rejects once the allowance is reached', async () => {
    await login();
    expect(
      (await activateSubscription(currentUserId(), 'business')).status
    ).toBe(200);

    // Business seeds `{ sessions: 25 }`; the 26th sign-in still succeeds and
    // silently drops the oldest device - login never 403s on this path.
    for (let i = 0; i < 25; i++) await login();

    expect(tokensHeldBy(currentUserId())).toBe(25);
  });
});

describe('GET /billing/premium-content shares the resolver', () => {
  function getPremium(token: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/billing/premium-content`, {
      headers: { authorization: `Bearer ${token}` }
    });
  }

  it('403s on Free and 200s once the plan reports the capability', async () => {
    const token = await login();
    expect((await getPremium(token)).status).toBe(403);

    expect((await activateSubscription(currentUserId(), 'pro')).status).toBe(
      200
    );
    expect((await getPremium(token)).status).toBe(200);
  });

  it('agrees with the entitlements read after a one-time grant', async () => {
    const token = await login();
    const userId = currentUserId();
    expect((await activateSubscription(userId, 'pro')).status).toBe(200);
    const customerId = customerIdOf(userId);
    for (const sub of getState().billingSubscriptions.values()) {
      sub.status = 'canceled';
    }
    getState().billingCustomerGrants.set('grant-3', {
      id: 'grant-3',
      customerId,
      entitlement: 'reports',
      sourceInvoiceId: 'inv-5',
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString()
    });

    const resolved = await readEntitlements(token);
    expect(resolved.capabilities).toContain('reports');
    expect((await getPremium(token)).status).toBe(200);
  });
});
