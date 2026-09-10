import type { Server } from 'http';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockUser, OAuthAccount } from '../types';

let server: Server;
let baseUrl: string;

const OAUTH_ONLY_ID = '920';
const OAUTH_ONLY_EMAIL = 'unlink-provider-only@example.com';
const PASSWORD_USER_EMAIL = 'user@example.com';
const PASSWORD = 'Password1';

function account(provider: string): OAuthAccount {
  return {
    provider,
    providerId: `${provider}-920`,
    createdAt: '2025-01-01T00:00:00.000Z'
  };
}

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

function passwordUser(): MockUser {
  return [...getState().users.values()].find(
    (u) => u.email === PASSWORD_USER_EMAIL
  ) as MockUser;
}

function seedOAuthOnlyUser(providers: string[]): void {
  getState().users.set(OAUTH_ONLY_ID, {
    ...passwordUser(),
    id: OAUTH_ONLY_ID,
    email: OAUTH_ONLY_EMAIL,
    password: null
  });
  getState().oauthAccounts.set(OAUTH_ONLY_ID, providers.map(account));
}

async function accessToken(userId: string): Promise<string> {
  const dataRes = await fetch(`${baseUrl}/__control/oauth-data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  expect(dataRes.status).toBe(200);
  const { token } = (await dataRes.json()) as { token: string };

  const exchange = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
    method: 'POST',
    headers: { cookie: `oauth_data=${token}` }
  });
  expect(exchange.status).toBe(200);
  const body = (await exchange.json()) as {
    tokens: { access_token: string };
  };
  return body.tokens.access_token;
}

async function issueProof(userId: string, operation: string): Promise<string> {
  const res = await fetch(`${baseUrl}/__control/reauth-proof`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, operation })
  });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  return token;
}

function unlink(
  accessTokenValue: string,
  provider: string,
  body?: unknown,
  proof?: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/oauth/accounts/${provider}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessTokenValue}`,
      ...(proof ? { cookie: `reauth_proof=${proof}` } : {})
    },
    body: JSON.stringify(body ?? {})
  });
}

// Removing a provider deletes a sign-in method, so the route demands the same
// fresh proof of identity the link route demands.
describe('DELETE /api/v1/auth/oauth/accounts/:provider demands a step-up', () => {
  it('refuses an account that holds a password and sends none', async () => {
    const user = passwordUser();
    getState().oauthAccounts.set(user.id, [account('google')]);
    const token = await accessToken(user.id);

    const res = await unlink(token, 'google');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    });
    expect(getState().oauthAccounts.get(user.id)).toHaveLength(1);
  });

  it('refuses a wrong password and records the refusal', async () => {
    const user = passwordUser();
    getState().oauthAccounts.set(user.id, [account('google')]);
    const token = await accessToken(user.id);

    const res = await unlink(token, 'google', {
      currentPassword: 'WrongPassword1'
    });

    expect(res.status).toBe(400);
    const audit = getState().auditLogs.filter(
      (row) => row.action === 'STEP_UP_FAILURE'
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: user.id,
      details: {
        operation: STEP_UP_OPERATION.OAUTH_UNLINK,
        factor: 'password'
      }
    });
  });

  it('accepts the current password', async () => {
    const user = passwordUser();
    getState().oauthAccounts.set(user.id, [account('google')]);
    const token = await accessToken(user.id);

    const res = await unlink(token, 'google', { currentPassword: PASSWORD });

    expect(res.status).toBe(200);
    expect(getState().oauthAccounts.get(user.id)).toHaveLength(0);
  });

  it('accepts a proof minted for the unlink on an account with no password', async () => {
    seedOAuthOnlyUser(['google', 'facebook']);
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(
      OAUTH_ONLY_ID,
      STEP_UP_OPERATION.OAUTH_UNLINK
    );

    const res = await unlink(token, 'google', {}, proof);

    expect(res.status).toBe(200);
    expect(getState().oauthAccounts.get(OAUTH_ONLY_ID)).toEqual([
      account('facebook')
    ]);
  });

  it('refuses a proof minted for another operation', async () => {
    seedOAuthOnlyUser(['google', 'facebook']);
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(OAUTH_ONLY_ID, STEP_UP_OPERATION.OAUTH_LINK);

    const res = await unlink(token, 'google', {}, proof);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
    });
    expect(getState().oauthAccounts.get(OAUTH_ONLY_ID)).toHaveLength(2);
  });

  // The provider name is validated first, so a typo costs no step-up.
  it('reports an unknown provider before it asks for a factor', async () => {
    const token = await accessToken(passwordUser().id);

    const res = await unlink(token, 'myspace');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.INVALID_OAUTH_PROVIDER
    });
  });

  it('rejects a currentPassword of the wrong shape', async () => {
    const token = await accessToken(passwordUser().id);

    const res = await unlink(token, 'google', { currentPassword: '' });

    expect(res.status).toBe(400);
  });

  // The step-up runs first, so the last-provider refusal is reached only by a
  // caller that already proved itself.
  it('still refuses to strip the only sign-in method', async () => {
    seedOAuthOnlyUser(['google']);
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(
      OAUTH_ONLY_ID,
      STEP_UP_OPERATION.OAUTH_UNLINK
    );

    const res = await unlink(token, 'google', {}, proof);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.UNLINK_LAST_PROVIDER
    });
  });
});
