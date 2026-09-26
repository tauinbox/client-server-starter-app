import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const USER_EMAIL = 'user@example.com';
const ADMIN_EMAIL = 'admin@example.com';
const SEED_PASSWORD = 'Password1';

type Session = { accessToken: string; refreshCookie: string };

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

async function signIn(email: string): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD })
  });
  expect(res.status).toBe(200);
  const match = /refresh_token=([^;]+)/.exec(
    res.headers.get('set-cookie') ?? ''
  );
  const body = (await res.json()) as { tokens: { access_token: string } };
  return {
    accessToken: body.tokens.access_token,
    refreshCookie: `refresh_token=${match?.[1] ?? ''}`
  };
}

function refresh(session: Session): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
    method: 'POST',
    headers: { cookie: session.refreshCookie }
  });
}

function profile(accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/profile`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

function iatOf(accessToken: string): number {
  const payload = JSON.parse(
    Buffer.from(accessToken.split('.')[1], 'base64url').toString()
  ) as { iat: number };
  return payload.iat;
}

function supportRoleId(): string {
  const role = [...getState().roles.values()].find((r) => r.name === 'support');
  return role!.id;
}

describe('a role change ends the sessions (UserRoleChangedListener)', () => {
  it.each([
    ['assign', 'POST'],
    ['unassign', 'DELETE']
  ])('refuses the refresh token after a role %s', async (_label, method) => {
    const userId = findUserByEmail(USER_EMAIL)!.id;
    const roleId = supportRoleId();
    const admin = await signIn(ADMIN_EMAIL);

    if (method === 'DELETE') {
      findUserByEmail(USER_EMAIL)!.roles.push('support');
    }
    const user = await signIn(USER_EMAIL);

    const url =
      method === 'POST'
        ? `${baseUrl}/api/v1/roles/assign/${userId}`
        : `${baseUrl}/api/v1/roles/assign/${userId}/${roleId}`;
    const change = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${admin.accessToken}`
      },
      body: method === 'POST' ? JSON.stringify({ roleId }) : undefined
    });
    expect(change.status).toBeLessThan(300);

    expect((await refresh(user)).status).toBe(401);
    expect((await profile(user.accessToken)).status).toBe(401);
  });
});

describe('a user delete ends the sessions (SessionRevocationListener)', () => {
  it('stamps tokenRevokedAt and refuses the refresh token', async () => {
    const userId = findUserByEmail(USER_EMAIL)!.id;
    const admin = await signIn(ADMIN_EMAIL);
    const user = await signIn(USER_EMAIL);

    const res = await fetch(`${baseUrl}/api/v1/users/${userId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin.accessToken}` }
    });
    expect(res.status).toBe(200);

    expect(getState().users.get(userId)!.tokenRevokedAt).not.toBeNull();
    expect((await refresh(user)).status).toBe(401);
  });
});

describe('the revocation stamp is compared at whole seconds (JwtStrategy)', () => {
  it('accepts a token issued later in the second the revocation landed in', async () => {
    const user = await signIn(USER_EMAIL);
    findUserByEmail(USER_EMAIL)!.tokenRevokedAt = new Date(
      iatOf(user.accessToken) * 1000 + 500
    ).toISOString();

    expect((await profile(user.accessToken)).status).toBe(200);
  });
});

describe('POST /__control/invalidate-access-tokens', () => {
  it('ends an access token issued in the same second and keeps the refresh token', async () => {
    const user = await signIn(USER_EMAIL);
    const userId = findUserByEmail(USER_EMAIL)!.id;

    await fetch(`${baseUrl}/__control/invalidate-access-tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId })
    });

    expect((await profile(user.accessToken)).status).toBe(401);

    const refreshed = await refresh(user);
    expect(refreshed.status).toBe(200);
    const body = (await refreshed.json()) as {
      tokens: { access_token: string };
    };
    expect((await profile(body.tokens.access_token)).status).toBe(200);
  });
});
