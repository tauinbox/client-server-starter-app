import type { Server } from 'http';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockUser, OAuthAccount } from '../types';

let server: Server;
let baseUrl: string;

const OAUTH_ONLY_ID = '930';
const OAUTH_ONLY_EMAIL = 'single-use-proof@example.com';
const PASSWORD_USER_EMAIL = 'user@example.com';

function account(provider: string): OAuthAccount {
  return {
    provider,
    providerId: `${provider}-930`,
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
  getState().users.set(OAUTH_ONLY_ID, {
    ...([...getState().users.values()].find(
      (u) => u.email === PASSWORD_USER_EMAIL
    ) as MockUser),
    id: OAUTH_ONLY_ID,
    email: OAUTH_ONLY_EMAIL,
    password: null
  });
  getState().oauthAccounts.set(OAUTH_ONLY_ID, [
    account('google'),
    account('facebook'),
    account('github')
  ]);
});

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
  const body = (await exchange.json()) as { tokens: { access_token: string } };
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
  proof: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/oauth/accounts/${provider}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessTokenValue}`,
      cookie: `reauth_proof=${proof}`
    },
    body: '{}'
  });
}

function linkInit(accessTokenValue: string, proof: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/oauth/link-init`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessTokenValue}`,
      cookie: `reauth_proof=${proof}`
    },
    body: '{}'
  });
}

function clearsTheProof(res: Response): boolean {
  return res.headers
    .getSetCookie()
    .some((value) => value.startsWith('reauth_proof=;'));
}

/**
 * The server records the token id of the proof in a single-use ledger, so one
 * completed provider round trip authorises one change. The mock holds proofs in
 * a map and deletes the record on the first presentation that passes every
 * other check, which is the same property.
 */
describe('a reauth proof is spent on its first successful use', () => {
  it('refuses the same proof on a second unlink', async () => {
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(
      OAUTH_ONLY_ID,
      STEP_UP_OPERATION.OAUTH_UNLINK
    );

    const first = await unlink(token, 'google', proof);
    expect(first.status).toBe(200);

    const second = await unlink(token, 'facebook', proof);

    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
    });
    expect(getState().oauthAccounts.get(OAUTH_ONLY_ID)).toHaveLength(2);
  });

  it('clears the cookie once the provider is removed', async () => {
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(
      OAUTH_ONLY_ID,
      STEP_UP_OPERATION.OAUTH_UNLINK
    );

    expect(clearsTheProof(await unlink(token, 'google', proof))).toBe(true);
  });

  it('keeps the cookie when the step-up refuses the caller', async () => {
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(OAUTH_ONLY_ID, STEP_UP_OPERATION.OAUTH_LINK);

    const res = await unlink(token, 'google', proof);

    expect(res.status).toBe(400);
    expect(clearsTheProof(res)).toBe(false);
  });

  it('does not spend a proof offered for another operation', async () => {
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(OAUTH_ONLY_ID, STEP_UP_OPERATION.OAUTH_LINK);

    expect((await unlink(token, 'google', proof)).status).toBe(400);

    const accepted = await linkInit(token, proof);

    expect(accepted.status).toBe(200);
    expect(clearsTheProof(accepted)).toBe(true);
  });

  it('refuses the same proof on a second link-init', async () => {
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(OAUTH_ONLY_ID, STEP_UP_OPERATION.OAUTH_LINK);

    expect((await linkInit(token, proof)).status).toBe(200);

    const second = await linkInit(token, proof);

    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
    });
  });
});
