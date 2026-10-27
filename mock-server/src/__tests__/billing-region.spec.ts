import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import type { BillingProviderId } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockSubscription } from '../types';
import { mockId } from '../utils/mock-id';
import { readErrorBody } from '../utils/error-body';

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

async function region(
  method: 'GET' | 'PUT',
  token: string,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/v1/billing/region`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>
  };
}

async function disableProvider(provider: BillingProviderId): Promise<void> {
  const res = await fetch(`${baseUrl}/__control/billing/provider-enabled`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, enabled: false })
  });
  expect(res.status).toBe(200);
}

describe('GET /billing/region available providers (server parity)', () => {
  it('lists both providers when both are enabled', async () => {
    const token = await login('user@example.com');

    const current = await region('GET', token);

    expect(current.body['availableProviders']).toEqual(['paddle', 'yookassa']);
  });

  it('drops a disabled provider from the list', async () => {
    await disableProvider('yookassa');
    const token = await login('user@example.com');

    const current = await region('GET', token);

    expect(current.body['availableProviders']).toEqual(['paddle']);
  });
});

describe('PUT /billing/region provider availability (server parity)', () => {
  it('refuses a region whose provider is unavailable and keeps the stored region', async () => {
    await disableProvider('yookassa');
    const token = await login('user@example.com');

    const refused = await region('PUT', token, { region: 'ru' });

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      message: 'Payments are not available in this billing region.',
      errorKey: ErrorKeys.BILLING.REGION_UNAVAILABLE,
      statusCode: 403
    });
    const current = await region('GET', token);
    expect(current.body['region']).toBe('auto');
  });

  it('still accepts a region whose provider is available', async () => {
    await disableProvider('yookassa');
    const token = await login('user@example.com');

    const accepted = await region('PUT', token, { region: 'world' });

    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      region: 'world',
      effectiveProvider: 'paddle'
    });
  });

  it('reports the unavailable region ahead of the live-subscription conflict', async () => {
    const activated = await fetch(
      `${baseUrl}/__control/billing/activate-subscription`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: mockId('user-2'), planKey: 'pro' })
      }
    );
    expect(activated.status).toBe(200);
    await disableProvider('yookassa');
    const token = await login('user@example.com');

    const refused = await region('PUT', token, { region: 'ru' });

    expect(refused.status).toBe(403);
    expect(refused.body['errorKey']).toBe(ErrorKeys.BILLING.REGION_UNAVAILABLE);
  });
});

describe('PUT /billing/region with an unpaid checkout (server parity)', () => {
  async function checkout(token: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/v1/billing/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ planKey: 'pro' })
    });
    expect(res.status).toBe(200);
  }

  async function yookassaCheckout(token: string): Promise<MockSubscription> {
    expect((await region('PUT', token, { region: 'ru' })).status).toBe(200);
    const before = new Set(getState().billingSubscriptions.keys());
    await checkout(token);
    const created = [...getState().billingSubscriptions.values()].find(
      (s) => !before.has(s.id)
    );
    expect(created).toMatchObject({
      status: 'incomplete',
      provider: 'yookassa',
      lifecycleOwner: 'self'
    });
    return created!;
  }

  it('releases a self-managed incomplete row and changes the region', async () => {
    const token = await login('user@example.com');
    const pending = await yookassaCheckout(token);

    const changed = await region('PUT', token, { region: 'world' });

    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      region: 'world',
      effectiveProvider: 'paddle'
    });
    expect(pending.status).toBe('canceled');
  });

  it('keeps blocking a provider-owned incomplete row', async () => {
    const token = await login('user@example.com');
    const pending = await yookassaCheckout(token);
    pending.provider = 'paddle';
    pending.lifecycleOwner = 'provider';

    const refused = await region('PUT', token, { region: 'ru' });

    expect(refused.status).toBe(409);
    expect(refused.body['errorKey']).toBe(
      ErrorKeys.BILLING.REGION_CHANGE_BLOCKED
    );
    expect(pending.status).toBe('incomplete');
  });
});

describe('checkout and purchase on an unavailable provider (server parity)', () => {
  async function post(
    path: string,
    token: string,
    body: unknown
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    return {
      status: res.status,
      body: await readErrorBody(res)
    };
  }

  const unavailable = {
    message: 'Billing provider "paddle" is not available',
    errorKey: ErrorKeys.BILLING.PROVIDER_UNAVAILABLE,
    statusCode: 503
  };

  it('answers 503 on checkout', async () => {
    await disableProvider('paddle');
    const token = await login('user@example.com');

    const res = await post('/billing/checkout', token, { planKey: 'pro' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual(unavailable);
  });

  it('answers 503 on a one-time purchase', async () => {
    await disableProvider('paddle');
    const token = await login('user@example.com');

    const res = await post('/billing/purchase', token, {
      productKey: 'report-pack'
    });

    expect(res.status).toBe(503);
    expect(res.body).toEqual(unavailable);
  });

  function narrowPaddleKillSwitch(environments: string[]): void {
    for (const flag of getState().featureFlags.values()) {
      if (flag.key === 'billing-paddle') {
        flag.enabled = true;
        flag.environments = environments;
      }
    }
  }

  it('answers 503 when the enabled kill switch targets another environment', async () => {
    narrowPaddleKillSwitch(['e2e-no-such-environment']);
    const token = await login('user@example.com');

    const res = await post('/billing/checkout', token, { planKey: 'pro' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual(unavailable);
    const current = await region('GET', token);
    expect(current.body['availableProviders']).toEqual(['yookassa']);
  });

  it('accepts checkout when the kill switch matches the environment', async () => {
    narrowPaddleKillSwitch([]);
    const token = await login('user@example.com');

    const res = await fetch(`${baseUrl}/api/v1/billing/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ planKey: 'pro' })
    });

    expect(res.status).toBe(200);
  });
});
