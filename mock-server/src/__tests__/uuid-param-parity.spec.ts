import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
import { mockId } from '../utils/mock-id';

let server: Server;
let baseUrl: string;

const BAD_ID = 'not-a-uuid';
// Well-formed but absent from the seed, so a route that gets past the guard
// fails on lookup rather than on id shape.
const UNKNOWN_ID = mockId('absent-from-seed');

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

async function loginAsAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

function send(
  method: string,
  path: string,
  token: string
): Promise<globalThis.Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: method === 'GET' || method === 'DELETE' ? undefined : '{}'
  });
}

// Every route whose server counterpart carries `@Param(..., ParseUUIDPipe)`.
// Kept in sync with `grep -rn "ParseUUIDPipe)" server/src --include=*.ts`.
const GUARDED_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['GET', `/api/v1/users/${BAD_ID}`],
  ['GET', `/api/v1/users/${BAD_ID}/permissions`],
  ['PATCH', `/api/v1/users/${BAD_ID}`],
  ['DELETE', `/api/v1/users/${BAD_ID}`],
  ['POST', `/api/v1/users/${BAD_ID}/restore`],

  ['GET', `/api/v1/roles/${BAD_ID}`],
  ['GET', `/api/v1/roles/${BAD_ID}/permissions`],
  ['PATCH', `/api/v1/roles/${BAD_ID}`],
  ['DELETE', `/api/v1/roles/${BAD_ID}`],
  ['PUT', `/api/v1/roles/${BAD_ID}/permissions`],
  ['POST', `/api/v1/roles/${BAD_ID}/permissions`],
  ['DELETE', `/api/v1/roles/${BAD_ID}/permissions/${BAD_ID}`],
  ['DELETE', `/api/v1/roles/${UNKNOWN_ID}/permissions/${BAD_ID}`],
  ['POST', `/api/v1/roles/assign/${BAD_ID}`],
  ['DELETE', `/api/v1/roles/assign/${BAD_ID}/${BAD_ID}`],
  ['DELETE', `/api/v1/roles/assign/${UNKNOWN_ID}/${BAD_ID}`],

  ['POST', `/api/v1/rbac/resources/${BAD_ID}/restore`],
  ['PATCH', `/api/v1/rbac/resources/${BAD_ID}`],
  ['PATCH', `/api/v1/rbac/actions/${BAD_ID}`],
  ['DELETE', `/api/v1/rbac/actions/${BAD_ID}`],

  ['GET', `/api/v1/admin/feature-flags/${BAD_ID}`],
  ['PATCH', `/api/v1/admin/feature-flags/${BAD_ID}`],
  ['DELETE', `/api/v1/admin/feature-flags/${BAD_ID}`],
  ['PUT', `/api/v1/admin/feature-flags/${BAD_ID}/rules`],
  ['POST', `/api/v1/admin/feature-flags/${BAD_ID}/preview`],
  ['POST', `/api/v1/admin/feature-flags/${BAD_ID}/toggle`],

  ['POST', `/api/v1/admin/billing/subscriptions/${BAD_ID}/cancel`],
  ['POST', `/api/v1/admin/billing/invoices/${BAD_ID}/refund`],
  ['POST', `/api/v1/admin/billing/webhook-events/${BAD_ID}/replay`]
];

describe('ParseUUIDPipe parity with server', () => {
  it.each(GUARDED_ROUTES)(
    '%s %s rejects a malformed id',
    async (method, path) => {
      const token = await loginAsAdmin();

      const res = await send(method, path, token);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string; errors?: string[] };
      expect(body.message).toBe('Validation failed (uuid is expected)');
    }
  );

  it('sends a bare message with no errors array', async () => {
    const token = await loginAsAdmin();

    const res = await send('GET', `/api/v1/users/${BAD_ID}`, token);

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      message: string;
      statusCode: number;
      error: string;
      errors?: string[];
    };
    expect(body).toEqual({
      message: 'Validation failed (uuid is expected)',
      statusCode: 400,
      error: 'Bad Request'
    });
    expect(body.errors).toBeUndefined();
  });

  it('runs after the auth guard, as the pipe does on the server', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/${BAD_ID}`);

    expect(res.status).toBe(401);
  });

  it('lets a well-formed but unknown id through to the lookup', async () => {
    const token = await loginAsAdmin();

    const res = await send('GET', `/api/v1/users/${UNKNOWN_ID}`, token);

    expect(res.status).toBe(404);
  });
});
