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

  describe('a YooKassa first payment that activates nothing is refunded', () => {
    async function ruSession(token: string, planKey: string) {
      const session = await openSession(token, '/checkout', { planKey });
      expect(session.provider).toBe('yookassa');
      return session;
    }

    function invoiceStatuses(): string[] {
      return [...getState().billingInvoices.values()].map((i) => i.status);
    }

    it('when a second tab pays the same plan', async () => {
      const { token } = await login();
      await call(token, 'PUT', '/region', { region: 'ru' });
      const tabA = await ruSession(token, 'pro');
      const tabB = await ruSession(token, 'pro');

      expect((await pay(tabA.url)).status).toBe(200);
      expect((await pay(tabB.url)).status).toBe(200);

      expect([...getState().billingSubscriptions.values()]).toEqual([
        expect.objectContaining({ planKey: 'pro', status: 'active' })
      ]);
      expect(invoiceStatuses()).toEqual(['paid', 'refunded']);
    });

    it('when a later checkout moved the row to another plan', async () => {
      const { token } = await login();
      await call(token, 'PUT', '/region', { region: 'ru' });
      const tabA = await ruSession(token, 'pro');
      await ruSession(token, 'business');

      expect((await pay(tabA.url)).status).toBe(200);

      expect([...getState().billingSubscriptions.values()]).toEqual([
        expect.objectContaining({ planKey: 'business', status: 'incomplete' })
      ]);
      expect([...getState().billingInvoices.values()]).toEqual([
        expect.objectContaining({
          status: 'refunded',
          refundedMinor: expect.any(Number) as number
        })
      ]);
    });

    it('when the row was cancelled first', async () => {
      const { token } = await login();
      await call(token, 'PUT', '/region', { region: 'ru' });
      const session = await ruSession(token, 'pro');
      for (const sub of getState().billingSubscriptions.values()) {
        sub.status = 'canceled';
      }

      expect((await pay(session.url)).status).toBe(200);

      expect([...getState().billingSubscriptions.values()]).toEqual([
        expect.objectContaining({ status: 'canceled' })
      ]);
      expect(invoiceStatuses()).toEqual(['refunded']);
    });
  });

  it('gives one trial for each customer: a checkout after a cancel pays in full', async () => {
    const { token } = await login();
    for (const plan of getState().plans.values()) {
      if (plan.key === 'pro') plan.trialDays = 14;
    }
    await call(token, 'PUT', '/region', { region: 'ru' });

    const first = await openSession(token, '/checkout', { planKey: 'pro' });
    expect((await pay(first.url)).status).toBe(200);
    expect([...getState().billingSubscriptions.values()]).toEqual([
      expect.objectContaining({ status: 'trialing' })
    ]);
    const [customer] = getState().billingCustomers.values();
    expect(customer.trialUsedAt).toEqual(expect.any(String));

    const cancel = await call(token, 'POST', '/subscription/cancel', {
      mode: 'immediate'
    });
    expect(cancel.status).toBe(200);

    const second = await openSession(token, '/checkout', { planKey: 'pro' });
    const open = [...getState().billingSubscriptions.values()].find(
      (s) => s.status === 'incomplete'
    );
    expect(open?.trialEnd).toBeNull();
    expect((await pay(second.url)).status).toBe(200);

    expect(
      [...getState().billingInvoices.values()].map((i) => i.amountMinor)
    ).toEqual([0, 99000]);
    expect(
      [...getState().billingSubscriptions.values()].map((s) => s.status)
    ).toEqual(['canceled', 'active']);
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
