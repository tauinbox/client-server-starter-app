import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

/**
 * Mirrors `decodeCursor`: the server answers a cursor that does not decode
 * with a 400 that carries an errorKey. The mock started the list from the
 * first row instead.
 */
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

async function adminToken(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

const LIST_ROUTES = [
  '/api/v1/users/cursor',
  '/api/v1/roles/cursor',
  '/api/v1/rbac/resources/cursor',
  '/api/v1/admin/feature-flags/cursor',
  '/api/v1/admin/billing/subscriptions',
  '/api/v1/admin/billing/invoices',
  '/api/v1/billing/invoices'
];

describe('an invalid cursor', () => {
  it.each(LIST_ROUTES)('is a keyed 400 on %s', async (route) => {
    const token = await adminToken();

    const res = await fetch(`${baseUrl}${route}?cursor=not-a-cursor`, {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: 'Invalid cursor',
      statusCode: 400,
      errorKey: ErrorKeys.GENERAL.INVALID_CURSOR
    });
  });

  it.each(LIST_ROUTES)('leaves a valid first page on %s', async (route) => {
    const token = await adminToken();

    const res = await fetch(`${baseUrl}${route}`, {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.status).toBe(200);
  });
});
