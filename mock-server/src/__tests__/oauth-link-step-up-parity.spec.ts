import type { Server } from 'http';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockUser } from '../types';

let server: Server;
let baseUrl: string;

const OAUTH_ONLY_ID = '910';
const OAUTH_ONLY_EMAIL = 'link-provider-only@example.com';
const PASSWORD_USER_EMAIL = 'user@example.com';
const PASSWORD = 'Password1';

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

function seedOAuthOnlyUser(): void {
  getState().users.set(OAUTH_ONLY_ID, {
    ...passwordUser(),
    id: OAUTH_ONLY_ID,
    email: OAUTH_ONLY_EMAIL,
    password: null
  });
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

function linkInit(
  accessTokenValue: string,
  body: unknown,
  proof?: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/oauth/link-init`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessTokenValue}`,
      ...(proof ? { cookie: `reauth_proof=${proof}` } : {})
    },
    body: JSON.stringify(body)
  });
}

// A linked provider signs the account in and no recovery path removes it, so
// the route demands the same fresh proof of identity the other credential
// changes demand.
describe('POST /api/v1/auth/oauth/link-init demands a step-up', () => {
  it('refuses an account that holds a password and sends none', async () => {
    const token = await accessToken(passwordUser().id);

    const res = await linkInit(token, {});

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    });
  });

  it('refuses a wrong password and records the refusal', async () => {
    const user = passwordUser();
    const token = await accessToken(user.id);

    const res = await linkInit(token, { currentPassword: 'WrongPassword1' });

    expect(res.status).toBe(400);
    const audit = getState().auditLogs.filter(
      (row) => row.action === 'STEP_UP_FAILURE'
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: user.id,
      details: {
        operation: STEP_UP_OPERATION.OAUTH_LINK,
        factor: 'password'
      }
    });
  });

  it('accepts the current password', async () => {
    const token = await accessToken(passwordUser().id);

    const res = await linkInit(token, { currentPassword: PASSWORD });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Link initiated' });
  });

  it('accepts a proof minted for the link on an account with no password', async () => {
    seedOAuthOnlyUser();
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(OAUTH_ONLY_ID, STEP_UP_OPERATION.OAUTH_LINK);

    const res = await linkInit(token, {}, proof);

    expect(res.status).toBe(200);
  });

  it('refuses a proof minted for another operation', async () => {
    seedOAuthOnlyUser();
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(OAUTH_ONLY_ID, STEP_UP_OPERATION.MFA_SETUP);

    const res = await linkInit(token, {}, proof);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
    });
  });

  it('rejects a currentPassword of the wrong shape', async () => {
    const token = await accessToken(passwordUser().id);

    const res = await linkInit(token, { currentPassword: '' });

    expect(res.status).toBe(400);
  });
});
