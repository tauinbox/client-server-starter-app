import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type {
  CreditBalanceResponse,
  InvoiceResponse,
  ProductResponse,
  PurchaseSessionResponse
} from '@app/shared/types';
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

function getProducts(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing/products`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

function postPurchase(token: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing/purchase`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

function completePurchase(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/__control/billing/complete-purchase`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('GET /billing/products', () => {
  it('requires auth', async () => {
    const res = await fetch(`${baseUrl}/api/v1/billing/products`);
    expect(res.status).toBe(401);
  });

  it('lists the seeded catalog priced for the effective provider, custom bounds included', async () => {
    const token = await login();
    const res = await getProducts(token);
    expect(res.status).toBe(200);
    const products = (await res.json()) as ProductResponse[];

    expect(products.map((p) => p.key)).toEqual([
      'report-pack',
      'donation',
      'credits-500',
      'credits-1000',
      'credits-5000'
    ]);
    // en-locale seed user resolves to paddle/USD.
    expect(products[0].prices.paddle).toEqual({
      currency: 'USD',
      amountMinor: 500
    });
    expect(products[1].type).toBe('custom');
    expect(products[1].prices.paddle).toEqual({
      currency: 'USD',
      minAmountMinor: 100,
      maxAmountMinor: 50000
    });
  });
});

describe('POST /billing/purchase', () => {
  it('rejects an unknown product with 404', async () => {
    const token = await login();
    const res = await postPurchase(token, { productKey: 'nope' });
    expect(res.status).toBe(404);
  });

  it('rejects a missing custom amount with 400', async () => {
    const token = await login();
    const res = await postPurchase(token, { productKey: 'donation' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(
      'amountMinor is required for a custom-amount product'
    );
  });

  it.each([99, 50001])(
    'rejects a custom amount outside the bounds (%d)',
    async (amountMinor) => {
      const token = await login();
      const res = await postPurchase(token, {
        productKey: 'donation',
        amountMinor
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe('amountMinor must be between 100 and 50000');
    }
  );

  it('opens a provider session for an sku at the catalog price', async () => {
    const token = await login();
    const res = await postPurchase(token, {
      productKey: 'report-pack',
      amountMinor: 1
    });
    expect(res.status).toBe(200);
    const session = (await res.json()) as PurchaseSessionResponse;
    expect(session.provider).toBe('paddle');
    expect(session.url).toContain(session.sessionRef);
  });
});

describe('/__control/billing/complete-purchase', () => {
  it('settles an sku purchase into a paid one_time invoice and unlocks the entitlement', async () => {
    const token = await login();
    const purchase = await postPurchase(token, { productKey: 'report-pack' });
    const session = (await purchase.json()) as PurchaseSessionResponse;

    // Before settlement the seed user (no subscription) lacks the entitlement.
    const before = await fetch(`${baseUrl}/api/v1/billing/premium-content`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(before.status).toBe(403);

    const complete = await completePurchase({
      sessionRef: session.sessionRef
    });
    expect(complete.status).toBe(200);
    const invoice = (await complete.json()) as InvoiceResponse;
    expect(invoice).toMatchObject({
      kind: 'one_time',
      status: 'paid',
      subscriptionId: null,
      providerInvoiceRef: session.sessionRef,
      amountMinor: 500,
      currency: 'USD'
    });

    // The grant now unions into the entitlement check (server parity).
    const after = await fetch(`${baseUrl}/api/v1/billing/premium-content`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(after.status).toBe(200);

    // The invoice is visible in the buyer's history.
    const invoices = await fetch(`${baseUrl}/api/v1/billing/invoices`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const list = (await invoices.json()) as InvoiceResponse[];
    expect(list.map((i) => i.id)).toContain(invoice.id);

    // Settlement is once-per-session — a replay finds nothing pending.
    const replay = await completePurchase({ sessionRef: session.sessionRef });
    expect(replay.status).toBe(404);
  });

  it('settles a donation at the buyer-chosen amount without any grant', async () => {
    const token = await login();
    const purchase = await postPurchase(token, {
      productKey: 'donation',
      amountMinor: 1500
    });
    const session = (await purchase.json()) as PurchaseSessionResponse;

    // Settle via the userId path (latest pending session for the buyer).
    const complete = await completePurchase({ userId: '2' });
    expect(complete.status).toBe(200);
    const invoice = (await complete.json()) as InvoiceResponse;
    expect(invoice).toMatchObject({
      kind: 'one_time',
      status: 'paid',
      providerInvoiceRef: session.sessionRef,
      amountMinor: 1500
    });

    // A donation grants nothing.
    const premium = await fetch(`${baseUrl}/api/v1/billing/premium-content`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(premium.status).toBe(403);
  });

  it('settles a credit pack into the prepaid balance', async () => {
    const token = await login();

    // Before any purchase the balance read is null (rendered as zero).
    const before = await fetch(`${baseUrl}/api/v1/billing/credits`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(before.status).toBe(200);
    expect(await before.json()).toBeNull();

    const purchase = await postPurchase(token, { productKey: 'credits-500' });
    const session = (await purchase.json()) as PurchaseSessionResponse;
    const complete = await completePurchase({ sessionRef: session.sessionRef });
    expect(complete.status).toBe(200);

    const after = await fetch(`${baseUrl}/api/v1/billing/credits`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const balance = (await after.json()) as CreditBalanceResponse;
    expect(balance.balanceUnits).toBe(500);

    // A second pack accumulates on the same balance.
    const again = await postPurchase(token, { productKey: 'credits-1000' });
    const session2 = (await again.json()) as PurchaseSessionResponse;
    await completePurchase({ sessionRef: session2.sessionRef });
    const accumulated = await fetch(`${baseUrl}/api/v1/billing/credits`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const total = (await accumulated.json()) as CreditBalanceResponse;
    expect(total.balanceUnits).toBe(1500);
  });
});

describe('GET /billing/credits', () => {
  it('requires auth', async () => {
    const res = await fetch(`${baseUrl}/api/v1/billing/credits`);
    expect(res.status).toBe(401);
  });
});
