import type { Server } from 'http';
import { MAX_PAGE_SIZE } from '@app/shared/constants/pagination.constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';
import type { MockInvoice } from '../types';

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

function get(token: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

/** Seeds `count` invoices whose creation timestamps are strictly increasing. */
function seedInvoices(count: number): void {
  for (let i = 0; i < count; i += 1) {
    const id = mockId(`invoice-${i}`);
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    const invoice: MockInvoice = {
      id,
      customerId: mockId('customer-1'),
      subscriptionId: null,
      provider: 'yookassa',
      providerInvoiceRef: `pay_${i}`,
      amountMinor: 1000 + i,
      currency: 'RUB',
      status: 'paid',
      billingMode: 'fixed',
      kind: 'subscription',
      productId: null,
      periodStart: createdAt,
      periodEnd: createdAt,
      paidAt: createdAt,
      receiptRef: null,
      createdAt,
      updatedAt: createdAt
    };
    getState().billingInvoices.set(id, invoice);
  }
}

type InvoicePage = {
  data: Array<{ id: string; amountMinor: number }>;
  meta: { page: number; limit: number; total: number; totalPages: number };
};

describe('GET /admin/billing/invoices — pagination parity', () => {
  it('returns the first page in the paginated envelope, newest first', async () => {
    seedInvoices(25);
    const token = await login('admin@example.com');

    const res = await get(token, '/api/v1/admin/billing/invoices?limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as InvoicePage;

    expect(body.data).toHaveLength(10);
    expect(body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3
    });
    // Newest first: the last-seeded invoice carries the highest amount.
    expect(body.data[0].amountMinor).toBe(1024);
  });

  it('serves a second page that does not overlap the first', async () => {
    seedInvoices(25);
    const token = await login('admin@example.com');

    const first = (await (
      await get(token, '/api/v1/admin/billing/invoices?page=1&limit=10')
    ).json()) as InvoicePage;
    const second = (await (
      await get(token, '/api/v1/admin/billing/invoices?page=2&limit=10')
    ).json()) as InvoicePage;

    expect(second.data).toHaveLength(10);
    expect(second.meta.page).toBe(2);
    const firstIds = new Set(first.data.map((i) => i.id));
    expect(second.data.some((i) => firstIds.has(i.id))).toBe(false);
  });

  it('rejects a limit above the shared maximum (400)', async () => {
    const token = await login('admin@example.com');

    const res = await get(
      token,
      `/api/v1/admin/billing/invoices?limit=${MAX_PAGE_SIZE + 1}`
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toContain(
      `limit must not be greater than ${MAX_PAGE_SIZE}`
    );
  });

  it('rejects an unknown query param the way forbidNonWhitelisted does', async () => {
    const token = await login('admin@example.com');

    const res = await get(token, '/api/v1/admin/billing/invoices?bogus=1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toContain('property bogus should not exist');
  });

  it('paginates the subscriptions list under the same envelope', async () => {
    const token = await login('admin@example.com');

    const res = await get(token, '/api/v1/admin/billing/subscriptions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as InvoicePage;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(10);
  });
});

describe('GET /billing/invoices — pagination parity', () => {
  it('returns an empty page for a caller with no billing customer', async () => {
    const token = await login('user@example.com');

    const res = await get(token, '/api/v1/billing/invoices');
    expect(res.status).toBe(200);
    const body = (await res.json()) as InvoicePage;
    expect(body.data).toEqual([]);
    expect(body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0
    });
  });

  it('rejects an out-of-range page the way the DTO does', async () => {
    const token = await login('user@example.com');

    const res = await get(token, '/api/v1/billing/invoices?page=0');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toContain('page must not be less than 1');
  });
});
