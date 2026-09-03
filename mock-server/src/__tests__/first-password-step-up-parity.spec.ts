import type { Server } from 'http';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockUser } from '../types';

let server: Server;
let baseUrl: string;

const OAUTH_ONLY_ID = '900';
const OAUTH_ONLY_EMAIL = 'provider-only@example.com';
const NEW_PASSWORD = 'Sunrise-Kettle-19';

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

function seedOAuthOnlyUser(): void {
  const template = [...getState().users.values()].find(
    (u) => u.email === 'user@example.com'
  ) as MockUser;

  getState().users.set(OAUTH_ONLY_ID, {
    ...template,
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

async function issueProof(
  userId: string,
  operation: string
): Promise<string | null> {
  const res = await fetch(`${baseUrl}/__control/reauth-proof`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, operation })
  });
  if (res.status !== 200) {
    return null;
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}

function patchProfile(
  accessTokenValue: string,
  body: unknown,
  proof?: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/profile`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessTokenValue}`,
      ...(proof ? { cookie: `reauth_proof=${proof}` } : {})
    },
    body: JSON.stringify(body)
  });
}

describe('PATCH /api/v1/auth/profile demands a step-up for a first password', () => {
  it('refuses a first password with no proof', async () => {
    seedOAuthOnlyUser();
    const token = await accessToken(OAUTH_ONLY_ID);

    const res = await patchProfile(token, { password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
    });
    expect(getState().users.get(OAUTH_ONLY_ID)?.password).toBeNull();
  });

  it('accepts a first password behind a proof minted for it', async () => {
    seedOAuthOnlyUser();
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(
      OAUTH_ONLY_ID,
      STEP_UP_OPERATION.PASSWORD_SET
    );

    const res = await patchProfile(
      token,
      { password: NEW_PASSWORD },
      proof as string
    );

    expect(res.status).toBe(200);
    expect(getState().users.get(OAUTH_ONLY_ID)?.password).toBe(NEW_PASSWORD);
  });

  it('refuses a proof minted for the email change', async () => {
    // One provider round trip must authorize one kind of change. Without the
    // binding, a proof taken for an address change would bind a credential.
    seedOAuthOnlyUser();
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(
      OAUTH_ONLY_ID,
      STEP_UP_OPERATION.EMAIL_CHANGE
    );

    const res = await patchProfile(
      token,
      { password: NEW_PASSWORD },
      proof as string
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
    });
    expect(getState().users.get(OAUTH_ONLY_ID)?.password).toBeNull();
  });

  it('clears the proof cookie once the password is bound', async () => {
    seedOAuthOnlyUser();
    const token = await accessToken(OAUTH_ONLY_ID);
    const proof = await issueProof(
      OAUTH_ONLY_ID,
      STEP_UP_OPERATION.PASSWORD_SET
    );

    const res = await patchProfile(
      token,
      { password: NEW_PASSWORD },
      proof as string
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('reauth_proof=;');
  });

  it('leaves an account that holds a password on the current-password rule', async () => {
    const token = await accessToken(
      [...getState().users.values()].find(
        (u) => u.email === 'user@example.com'
      )!.id
    );

    const res = await patchProfile(token, { password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    });
  });
});

describe('POST /__control/reauth-proof binds the proof to one operation', () => {
  it('refuses a body that names no operation', async () => {
    seedOAuthOnlyUser();

    const res = await fetch(`${baseUrl}/__control/reauth-proof`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: OAUTH_ONLY_ID })
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/oauth/reauth-init validates the operation', () => {
  it('400s on an unknown operation', async () => {
    seedOAuthOnlyUser();
    const token = await accessToken(OAUTH_ONLY_ID);

    const res = await fetch(`${baseUrl}/api/v1/auth/oauth/reauth-init`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ operation: 'delete_account' })
    });

    expect(res.status).toBe(400);
  });

  it('accepts a known operation', async () => {
    seedOAuthOnlyUser();
    const token = await accessToken(OAUTH_ONLY_ID);

    const res = await fetch(`${baseUrl}/api/v1/auth/oauth/reauth-init`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ operation: STEP_UP_OPERATION.PASSWORD_SET })
    });

    expect(res.status).toBe(200);
  });
});
