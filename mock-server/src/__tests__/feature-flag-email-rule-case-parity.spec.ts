import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

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

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

// The shared evaluator decides both servers: a rule value in upper case
// matches the canonical (lower-case) address of the user.
describe('email and emailDomain rules compare case-insensitively (parity)', () => {
  async function flagFor(
    effect: 'include' | 'exclude',
    payload: Record<string, unknown>
  ): Promise<boolean> {
    const admin = await login('admin@example.com');
    const key = `case-${effect}-${String(payload['field']).toLowerCase()}`;
    const createRes = await call(admin, 'POST', '/admin/feature-flags', {
      key,
      enabled: true,
      rules: [{ effect, payload }]
    });
    expect(createRes.status).toBe(201);
    const res = await call(admin, 'GET', '/feature-flags');
    const body = (await res.json()) as { flags: Record<string, boolean> };
    return body.flags[key] === true;
  }

  it('an exclude rule with an upper-case address excludes the user', async () => {
    expect(
      await flagFor('exclude', {
        type: 'attribute',
        field: 'email',
        op: 'eq',
        value: 'ADMIN@EXAMPLE.COM'
      })
    ).toBe(false);
  });

  it('an exclude rule with an upper-case domain excludes the user', async () => {
    expect(
      await flagFor('exclude', {
        type: 'attribute',
        field: 'emailDomain',
        op: 'in',
        value: ['EXAMPLE.COM']
      })
    ).toBe(false);
  });

  it('an include rule with a mixed-case address includes the user', async () => {
    expect(
      await flagFor('include', {
        type: 'attribute',
        field: 'email',
        op: 'eq',
        value: 'Admin@Example.com'
      })
    ).toBe(true);
  });
});
