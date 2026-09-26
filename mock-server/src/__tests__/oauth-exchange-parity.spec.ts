import type { Server } from 'http';
import {
  ErrorKeys,
  MAX_CONCURRENT_SESSIONS,
  MFA_PENDING_TOKEN_EXPIRY_SECONDS
} from '@app/shared/constants';
import { createApp } from '../app';
import { MOCK_TOTP_CODE } from '../constants';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

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

async function issueOAuthData(userId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/__control/oauth-data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function exchange(cookie?: string, presented?: string): Promise<Response> {
  const cookies = [cookie && `oauth_data=${cookie}`, presented].filter(Boolean);
  return fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
    method: 'POST',
    headers: cookies.length ? { cookie: cookies.join('; ') } : {}
  });
}

function refreshCookieOf(res: Response): string {
  const match = /refresh_token=([^;]+)/.exec(
    res.headers.get('set-cookie') ?? ''
  );
  expect(match).not.toBeNull();
  return `refresh_token=${match?.[1] ?? ''}`;
}

function liveTokensOf(userId: string): number {
  return [...getState().refreshTokens.values()].filter((id) => id === userId)
    .length;
}

describe('POST /api/v1/auth/oauth/exchange parity with server', () => {
  it('returns the auth response and sets the refresh cookie', async () => {
    const admin = findUserByEmail('admin@example.com');
    const token = await issueOAuthData(admin!.id);

    const res = await exchange(token);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tokens: Record<string, unknown>;
      user: { id: string; email: string };
    };
    expect(body.user).toMatchObject({
      id: admin!.id,
      email: 'admin@example.com'
    });
    expect(Object.keys(body.tokens).sort()).toEqual([
      'access_token',
      'expires_in'
    ]);
    // The refresh token is cookie-only, never part of the JSON body.
    expect(res.headers.get('set-cookie')).toContain('refresh_token=');
  });

  // The provider proves one credential only. An enrolled account is not signed
  // in by the round trip: it gets the same challenge the password path gives.
  it('answers with a challenge and no session for an enrolled account', async () => {
    const admin = findUserByEmail('admin@example.com');
    admin!.totpEnabledAt = new Date().toISOString();
    const refreshTokensBefore = getState().refreshTokens.size;

    const token = await issueOAuthData(admin!.id);
    const res = await exchange(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      mfaRequired: true,
      expiresIn: MFA_PENDING_TOKEN_EXPIRY_SECONDS
    });
    expect(res.headers.get('set-cookie')).not.toContain('refresh_token=');
    // The round trip minted no session, so there is no refresh row to abandon.
    expect(getState().refreshTokens.size).toBe(refreshTokensBefore);
  });

  it('mints a pending token the two-factor route accepts', async () => {
    const admin = findUserByEmail('admin@example.com');
    admin!.totpEnabledAt = new Date().toISOString();

    const token = await issueOAuthData(admin!.id);
    const body = (await (await exchange(token)).json()) as {
      mfaToken: string;
    };

    const verified = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mfaToken: body.mfaToken, code: MOCK_TOTP_CODE })
    });

    expect(verified.status).toBe(200);
    expect(verified.headers.get('set-cookie')).toContain('refresh_token=');
  });

  it('400s without the cookie', async () => {
    const res = await exchange();

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: 'Missing OAuth data',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.MISSING_OAUTH_DATA
    });
  });

  it('400s on an unknown cookie value', async () => {
    const res = await exchange('not-a-real-token');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: 'Invalid or expired OAuth data',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.INVALID_OAUTH_DATA
    });
  });

  it('400s on an expired payload', async () => {
    const admin = findUserByEmail('admin@example.com');
    const token = await issueOAuthData(admin!.id);
    const pending = getState().oauthDataTokens.get(token)!;
    pending.expiresAt = Date.now() - 1;

    const res = await exchange(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.INVALID_OAUTH_DATA
    });
  });

  it('is one-shot: a replayed cookie no longer exchanges', async () => {
    const admin = findUserByEmail('admin@example.com');
    const token = await issueOAuthData(admin!.id);

    expect((await exchange(token)).status).toBe(200);
    expect((await exchange(token)).status).toBe(400);
  });

  // The session is issued at the exchange, the one request that carries the
  // cookie of the session it replaces, as on the server.
  it('mints no session before the exchange', async () => {
    const admin = findUserByEmail('admin@example.com');
    const before = liveTokensOf(admin!.id);

    await issueOAuthData(admin!.id);

    expect(liveTokensOf(admin!.id)).toBe(before);
  });

  it('keeps every other device when the quota is full and the browser signs in again', async () => {
    const admin = findUserByEmail('admin@example.com');
    const devices: string[] = [];
    for (let i = 0; i < MAX_CONCURRENT_SESSIONS; i++) {
      devices.push(
        refreshCookieOf(await exchange(await issueOAuthData(admin!.id)))
      );
    }
    expect(liveTokensOf(admin!.id)).toBe(MAX_CONCURRENT_SESSIONS);

    const res = await exchange(
      await issueOAuthData(admin!.id),
      devices[devices.length - 1]
    );

    expect(res.status).toBe(200);
    expect(liveTokensOf(admin!.id)).toBe(MAX_CONCURRENT_SESSIONS);
    const refresh = (cookie: string) =>
      fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
        method: 'POST',
        headers: { cookie }
      }).then((r) => r.status);
    expect(await refresh(devices[devices.length - 1])).toBe(401);
    expect(await refresh(devices[0])).toBe(200);
  });

  it('refuses an account deactivated after the callback like a bad cookie', async () => {
    const admin = findUserByEmail('admin@example.com');
    const token = await issueOAuthData(admin!.id);
    admin!.isActive = false;

    const res = await exchange(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: 'Invalid or expired OAuth data',
      errorKey: ErrorKeys.AUTH.INVALID_OAUTH_DATA
    });
    expect(res.headers.get('set-cookie')).not.toContain('refresh_token=');
    expect(liveTokensOf(admin!.id)).toBe(0);
  });

  it('records the sign-in with its method and provider at the exchange', async () => {
    const admin = findUserByEmail('admin@example.com');
    const token = await issueOAuthData(admin!.id);
    expect(
      getState().auditLogs.filter((l) => l.action === 'USER_LOGIN_SUCCESS')
    ).toHaveLength(0);

    await exchange(token);

    const rows = getState().auditLogs.filter(
      (l) => l.action === 'USER_LOGIN_SUCCESS'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: admin!.id,
      details: { method: 'oauth', provider: 'google' }
    });
  });

  it('issues an access token that authenticates the session', async () => {
    const admin = findUserByEmail('admin@example.com');
    const token = await issueOAuthData(admin!.id);

    const body = (await (await exchange(token)).json()) as {
      tokens: { access_token: string };
    };
    const profile = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      headers: { authorization: `Bearer ${body.tokens.access_token}` }
    });

    expect(profile.status).toBe(200);
  });
});
