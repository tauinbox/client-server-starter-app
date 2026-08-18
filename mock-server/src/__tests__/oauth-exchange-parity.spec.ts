import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
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

function exchange(cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
    method: 'POST',
    headers: cookie ? { cookie: `oauth_data=${cookie}` } : {}
  });
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
