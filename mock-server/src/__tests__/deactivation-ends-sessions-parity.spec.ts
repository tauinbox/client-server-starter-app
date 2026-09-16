import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, resetState } from '../state';

let server: Server;
let baseUrl: string;

const USER_EMAIL = 'user@example.com';
const ADMIN_EMAIL = 'admin@example.com';
const SEED_PASSWORD = 'Password1';

type Session = { accessToken: string; refreshCookie: string };

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
  expect(match).not.toBeNull();
  const body = (await res.json()) as { tokens: { access_token: string } };
  return {
    accessToken: body.tokens.access_token,
    refreshCookie: `refresh_token=${match?.[1] ?? ''}`
  };
}

async function patchUser(
  admin: Session,
  body: Record<string, unknown>
): Promise<void> {
  const targetId = findUserByEmail(USER_EMAIL)!.id;
  const res = await fetch(`${baseUrl}/api/v1/users/${targetId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${admin.accessToken}`
    },
    body: JSON.stringify(body)
  });
  expect(res.status).toBe(200);
}

function refresh(session: Session): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
    method: 'POST',
    headers: { cookie: session.refreshCookie }
  });
}

describe('a deactivation ends the sessions', () => {
  it('refuses a refresh token issued before the account was deactivated', async () => {
    const user = await signIn(USER_EMAIL);
    const admin = await signIn(ADMIN_EMAIL);

    await patchUser(admin, { isActive: false });
    await patchUser(admin, { isActive: true });

    // Pre-fix the kept token minted a new access token here.
    const res = await refresh(user);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    });
  });

  it('keeps the session when the update does not deactivate', async () => {
    const user = await signIn(USER_EMAIL);
    const admin = await signIn(ADMIN_EMAIL);

    await patchUser(admin, { firstName: 'Renamed' });
    await patchUser(admin, { isActive: true });

    expect((await refresh(user)).status).toBe(200);
  });
});
