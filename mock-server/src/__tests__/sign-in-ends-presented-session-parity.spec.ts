import type { Server } from 'http';
import { createApp } from '../app';
import { MOCK_TOTP_CODE } from '../constants';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const USER = { email: 'user@example.com', password: 'Password1' };
const ADMIN = { email: 'admin@example.com', password: 'Password1' };

type Device = { accessToken: string; refreshCookie: string };

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

function refreshCookieOf(res: Response): string {
  const match = /refresh_token=([^;]+)/.exec(
    res.headers.get('set-cookie') ?? ''
  );
  expect(match).not.toBeNull();
  return `refresh_token=${match?.[1] ?? ''}`;
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

async function signIn(
  credentials: typeof USER,
  presented?: string
): Promise<Device> {
  const res = await post(
    '/auth/login',
    credentials,
    presented ? { cookie: presented } : {}
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return {
    accessToken: body.tokens.access_token,
    refreshCookie: refreshCookieOf(res)
  };
}

function refreshStatus(cookie: string): Promise<number> {
  return fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
    method: 'POST',
    headers: { cookie }
  }).then((res) => res.status);
}

function liveTokensOf(email: string): number {
  const id = findUserByEmail(email)?.id;
  return [...getState().refreshTokens.values()].filter((uid) => uid === id)
    .length;
}

describe('a sign-in ends the session of the presented refresh cookie', () => {
  it('a second password sign-in ends the session the browser replaces', async () => {
    const first = await signIn(USER);
    const second = await signIn(USER, first.refreshCookie);

    expect(liveTokensOf(USER.email)).toBe(1);
    await expect(refreshStatus(first.refreshCookie)).resolves.toBe(401);
    await expect(refreshStatus(second.refreshCookie)).resolves.toBe(200);
  });

  it('a sign-in to another account ends the replaced session too', async () => {
    const owner = await signIn(USER);

    await signIn(ADMIN, owner.refreshCookie);

    expect(liveTokensOf(USER.email)).toBe(0);
    await expect(refreshStatus(owner.refreshCookie)).resolves.toBe(401);
  });

  it('a failed sign-in ends nothing', async () => {
    const owner = await signIn(USER);

    const res = await post(
      '/auth/login',
      { email: USER.email, password: 'Wrong-Password-00' },
      { cookie: owner.refreshCookie }
    );

    expect(res.status).toBe(401);
    await expect(refreshStatus(owner.refreshCookie)).resolves.toBe(200);
  });

  it('the second factor, not the password, ends the replaced session', async () => {
    const owner = await signIn(USER);
    const auth = { authorization: `Bearer ${owner.accessToken}` };
    expect(
      (await post('/auth/mfa/setup', { currentPassword: USER.password }, auth))
        .status
    ).toBe(200);
    expect(
      (await post('/auth/mfa/enable', { code: MOCK_TOTP_CODE }, auth)).status
    ).toBe(200);
    // The enrolment spent the one fixed code.
    await fetch(`${baseUrl}/__control/totp-ledger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: findUserByEmail(USER.email)?.id })
    });

    const challenge = await post('/auth/login', USER, {
      cookie: owner.refreshCookie
    });
    const { mfaToken } = (await challenge.json()) as { mfaToken: string };
    expect(liveTokensOf(USER.email)).toBe(1);

    const verified = await post(
      '/auth/mfa/verify',
      { mfaToken, code: MOCK_TOTP_CODE },
      { cookie: owner.refreshCookie }
    );

    expect(verified.status).toBe(200);
    expect(liveTokensOf(USER.email)).toBe(1);
    await expect(refreshStatus(owner.refreshCookie)).resolves.toBe(401);
    await expect(refreshStatus(refreshCookieOf(verified))).resolves.toBe(200);
  });

  it('the provider exchange ends the replaced session', async () => {
    const owner = await signIn(USER);
    const issued = await fetch(`${baseUrl}/__control/oauth-data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: findUserByEmail(ADMIN.email)?.id })
    });
    const { token } = (await issued.json()) as { token: string };

    const res = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
      method: 'POST',
      headers: { cookie: `oauth_data=${token}; ${owner.refreshCookie}` }
    });

    expect(res.status).toBe(200);
    await expect(refreshStatus(owner.refreshCookie)).resolves.toBe(401);
    await expect(refreshStatus(refreshCookieOf(res))).resolves.toBe(200);
  });
});
