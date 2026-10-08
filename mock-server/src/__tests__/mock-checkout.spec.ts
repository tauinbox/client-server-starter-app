import type { Server } from 'http';
import type { CheckoutSessionResponse } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function login(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    tokens: { access_token: string };
    user: { id: string };
  };
  return { token: body.tokens.access_token, userId: body.user.id };
}

async function call(
  token: string,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown = {}
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

async function openSession(
  token: string,
  path: string,
  body: unknown
): Promise<CheckoutSessionResponse> {
  const res = await call(token, 'POST', path, body);
  expect(res.status).toBe(200);
  const session = (await res.json()) as CheckoutSessionResponse;
  expect(session.url).toBe(`/api/__mock-checkout/${session.sessionRef}`);
  return session;
}

function pay(url: string): Promise<Response> {
  return fetch(`${baseUrl}${url}/pay`, { method: 'POST' });
}

async function expectReturnTo(paid: Response, url: string): Promise<void> {
  expect(paid.status).toBe(200);
  expect(await paid.text()).toContain(
    `<meta http-equiv="refresh" content="0; url=${url}">`
  );
}

describe('mock checkout page', () => {
  it('pays a plan checkout into an active subscription and returns to success', async () => {
    const { token } = await login();
    const session = await openSession(token, '/checkout', { planKey: 'pro' });

    const page = await fetch(`${baseUrl}${session.url}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Plan: Pro');
    expect(html).toContain('href="/billing/cancel"');

    const paid = await pay(session.url);
    await expectReturnTo(paid, '/billing/success');

    const subscriptions = [...getState().billingSubscriptions.values()];
    expect(subscriptions).toEqual([
      expect.objectContaining({ planKey: 'pro', status: 'active' })
    ]);
    expect((await pay(session.url)).status).toBe(404);
  });

  it('settles on the provider of the checkout after a region override', async () => {
    const { token } = await login();
    expect((await call(token, 'PUT', '/region', { region: 'ru' })).status).toBe(
      200
    );
    const session = await openSession(token, '/checkout', { planKey: 'pro' });
    expect(session.provider).toBe('yookassa');

    expect((await pay(session.url)).status).toBe(200);

    const state = getState();
    expect([...state.billingSubscriptions.values()]).toEqual([
      expect.objectContaining({ provider: 'yookassa', status: 'active' })
    ]);
    expect([...state.billingInvoices.values()]).toEqual([
      expect.objectContaining({ provider: 'yookassa', currency: 'RUB' })
    ]);
  });

  it('pays a one-time purchase into a paid invoice and returns to success', async () => {
    const { token } = await login();
    const session = await openSession(token, '/purchase', {
      productKey: 'report-pack'
    });

    const html = await (await fetch(`${baseUrl}${session.url}`)).text();
    expect(html).toContain('Report pack');
    expect(html).toContain('$5.00');

    const paid = await pay(session.url);
    await expectReturnTo(paid, '/billing/success');
    expect([...getState().billingInvoices.values()]).toEqual([
      expect.objectContaining({
        kind: 'one_time',
        status: 'paid',
        providerInvoiceRef: session.sessionRef
      })
    ]);
    expect(getState().billingPurchaseSessions.size).toBe(0);
  });

  it('returns a payment-method update to the settings page', async () => {
    const { token, userId } = await login();
    await fetch(`${baseUrl}/__control/billing/activate-subscription`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, planKey: 'pro' })
    });
    const session = await openSession(token, '/payment-method', {});

    const html = await (await fetch(`${baseUrl}${session.url}`)).text();
    expect(html).toContain('href="/billing/settings"');

    const paid = await pay(session.url);
    await expectReturnTo(paid, '/billing/settings');
  });

  it('answers 404 for an unknown session', async () => {
    const res = await fetch(`${baseUrl}/api/__mock-checkout/unknown`);
    expect(res.status).toBe(404);
    expect((await pay('/api/__mock-checkout/unknown')).status).toBe(404);
  });
});
