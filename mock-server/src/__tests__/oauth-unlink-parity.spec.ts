import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
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

async function loginAsAdmin(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Password1'
    })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    tokens: { access_token: string };
    user: { id: string };
  };
  return { token: body.tokens.access_token, userId: body.user.id };
}

function unlink(token: string, provider: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/oauth/accounts/${provider}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` }
  });
}

describe('DELETE /api/v1/auth/oauth/accounts/:provider parity with server', () => {
  // The seeded admin has google linked and no other provider.
  it('404s without auditing when the provider is not linked', async () => {
    const { token } = await loginAsAdmin();
    const auditCountBefore = getState().auditLogs.length;

    const res = await unlink(token, 'facebook');

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      statusCode: 404,
      errorKey: ErrorKeys.AUTH.OAUTH_PROVIDER_NOT_LINKED
    });
    expect(getState().auditLogs).toHaveLength(auditCountBefore);
  });

  it('unlinks a linked provider when a password is set', async () => {
    const { token, userId } = await loginAsAdmin();

    const res = await unlink(token, 'google');

    expect(res.status).toBe(200);
    expect(getState().oauthAccounts.get(userId)).toHaveLength(0);
  });
});
