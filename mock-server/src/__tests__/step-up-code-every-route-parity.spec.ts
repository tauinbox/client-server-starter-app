import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { MOCK_TOTP_CODE } from '../constants';
import type { MockUser } from '../types';

// Mirrors server/test/step-up-code-every-route.e2e-spec.ts: an account with no
// password that carries an authenticator steps up with a code on every route.
let server: Server;
let baseUrl: string;

const OAUTH_ONLY_ID = '921';

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function oauthOnlyEnrolledToken(): Promise<string> {
  const template = [...getState().users.values()].find(
    (u) => u.email === 'user@example.com'
  ) as MockUser;
  getState().users.set(OAUTH_ONLY_ID, {
    ...template,
    id: OAUTH_ONLY_ID,
    email: 'step-up-code@example.com',
    password: null
  });

  const dataRes = await fetch(`${baseUrl}/__control/oauth-data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: OAUTH_ONLY_ID })
  });
  const { token } = (await dataRes.json()) as { token: string };
  const exchange = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
    method: 'POST',
    headers: { cookie: `oauth_data=${token}` }
  });
  const body = (await exchange.json()) as { tokens: { access_token: string } };

  // Enrolled after the sign-in, which would otherwise answer with a challenge.
  const user = getState().users.get(OAUTH_ONLY_ID) as MockUser;
  user.totpEnabledAt = '2025-01-01T00:00:00.000Z';
  return body.tokens.access_token;
}

function send(
  token: string,
  method: string,
  path: string,
  body: object
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

const routes: ReadonlyArray<
  [name: string, method: string, path: string, body: object]
> = [
  [
    'an email change',
    'POST',
    '/api/v1/auth/profile/email/initiate',
    { newEmail: 'step-up-code-new@example.com' }
  ],
  ['a provider link', 'POST', '/api/v1/auth/oauth/link-init', {}],
  [
    'a first password',
    'PATCH',
    '/api/v1/auth/profile',
    { password: 'Quarry-Bramble-83' }
  ]
];

describe.each(routes)('%s', (_name, method, path, body) => {
  it('refuses an account with no password that sends no factor', async () => {
    const token = await oauthOnlyEnrolledToken();

    const res = await send(token, method, path, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
    });
  });

  it('accepts an authenticator code instead of a provider proof', async () => {
    const token = await oauthOnlyEnrolledToken();

    const res = await send(token, method, path, {
      ...body,
      code: MOCK_TOTP_CODE
    });

    expect(res.status).toBe(200);
  });

  it('rejects a code of the wrong shape', async () => {
    const token = await oauthOnlyEnrolledToken();

    const res = await send(token, method, path, { ...body, code: '12' });

    expect(res.status).toBe(400);
  });
});
