import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const EMAIL = 'user@example.com';
const PASSWORD = 'Password1';
const NEW_PASSWORD = 'Sunrise-Kettle-19';

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
  const raw = res.headers.get('set-cookie') ?? '';
  const match = /refresh_token=([^;]+)/.exec(raw);
  expect(match).not.toBeNull();
  return `refresh_token=${match?.[1] ?? ''}`;
}

async function signIn(): Promise<Device> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return {
    accessToken: body.tokens.access_token,
    refreshCookie: refreshCookieOf(res)
  };
}

function profileStatus(device: Device): Promise<number> {
  return fetch(`${baseUrl}/api/v1/auth/profile`, {
    headers: { authorization: `Bearer ${device.accessToken}` }
  }).then((res) => res.status);
}

function logout(device: Device, withCookie = true): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${device.accessToken}`,
      ...(withCookie ? { cookie: device.refreshCookie } : {})
    }
  });
}

describe('per-device logout', () => {
  it('ends the signing-out device and leaves the other device signed in', async () => {
    const phone = await signIn();
    const desktop = await signIn();

    const res = await logout(phone);

    expect(res.status).toBe(200);
    await expect(profileStatus(phone)).resolves.toBe(401);
    await expect(profileStatus(desktop)).resolves.toBe(200);
  });

  it('leaves the refresh token of the other device usable', async () => {
    const phone = await signIn();
    const desktop = await signIn();

    await logout(phone);

    const refreshed = await fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
      method: 'POST',
      headers: { cookie: desktop.refreshCookie }
    });
    expect(refreshed.status).toBe(200);

    const stale = await fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
      method: 'POST',
      headers: { cookie: phone.refreshCookie }
    });
    expect(stale.status).toBe(401);
  });

  it('stamps no account-wide revocation', async () => {
    const phone = await signIn();

    await logout(phone);

    const user = [...getState().users.values()].find((u) => u.email === EMAIL);
    expect(user?.tokenRevokedAt ?? null).toBeNull();
  });

  it('revokes nothing when the request carries no refresh cookie', async () => {
    const phone = await signIn();

    const res = await logout(phone, false);

    expect(res.status).toBe(200);
    // The device is signed out locally; a cookie that failed to arrive must
    // not take the account's other devices down with it.
    await expect(profileStatus(phone)).resolves.toBe(200);
  });

  it('asks the browser to drop the cached resources and cookies of the origin', async () => {
    const phone = await signIn();

    const res = await logout(phone);

    expect(res.headers.get('clear-site-data')).toBe('"cache", "cookies"');
  });

  it('keeps a rotated access token alive inside the same session', async () => {
    const desktop = await signIn();

    const rotated = await fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
      method: 'POST',
      headers: { cookie: desktop.refreshCookie }
    });
    expect(rotated.status).toBe(200);

    // A per-row session id would have ended this token on the rotation another
    // tab of the same device performed.
    await expect(profileStatus(desktop)).resolves.toBe(200);
  });

  it('clears the rotated ancestors of the session it ends', async () => {
    const desktop = await signIn();

    const rotated = await fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
      method: 'POST',
      headers: { cookie: desktop.refreshCookie }
    });
    expect(rotated.status).toBe(200);

    await logout({
      accessToken: desktop.accessToken,
      refreshCookie: refreshCookieOf(rotated)
    });

    // The ancestor is kept for reuse detection while the session lives. A
    // session that ended keeps nothing, which is what deleting the whole chain
    // by session id buys on the real server.
    expect(getState().refreshTokens.size).toBe(0);
    expect(getState().revokedRefreshTokens.size).toBe(0);
  });

  it('still ends every session on a password change', async () => {
    const phone = await signIn();
    const desktop = await signIn();

    const changed = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${phone.accessToken}`
      },
      body: JSON.stringify({
        currentPassword: PASSWORD,
        password: NEW_PASSWORD
      })
    });
    expect(changed.status).toBe(200);

    await expect(profileStatus(phone)).resolves.toBe(401);
    await expect(profileStatus(desktop)).resolves.toBe(401);
  });
});
