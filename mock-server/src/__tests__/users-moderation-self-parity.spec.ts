import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, resetState } from '../state';

// Mirrors server/test/user-moderation-self.e2e-spec.ts: the seeded `user` role
// updates its own record, and must not reach the moderation fields with it.
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

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

function patchUser(
  token: string,
  id: string,
  payload: unknown
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/users/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

async function errorKeyOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { errorKey?: string }).errorKey;
}

describe('PATCH /api/v1/users/:id moderation of the own record', () => {
  it('refuses a deactivation of the own record and keeps the row active', async () => {
    const token = await login('user@example.com');
    const owner = findUserByEmail('user@example.com')!;

    const res = await patchUser(token, owner.id, { isActive: false });

    expect(res.status).toBe(400);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.USERS.MODERATION_SELF);
    expect(owner.isActive).toBe(true);
  });

  it('refuses an unlock of the own record and keeps the lock', async () => {
    const token = await login('user@example.com');
    const owner = findUserByEmail('user@example.com')!;
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    owner.failedLoginAttempts = 5;
    owner.lockedUntil = lockedUntil;

    const res = await patchUser(token, owner.id, { unlockAccount: true });

    expect(res.status).toBe(400);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.USERS.MODERATION_SELF);
    expect(owner.failedLoginAttempts).toBe(5);
    expect(owner.lockedUntil).toBe(lockedUntil);
  });

  it('keeps a name edit of the own record open', async () => {
    const token = await login('user@example.com');
    const owner = findUserByEmail('user@example.com')!;

    const res = await patchUser(token, owner.id, { firstName: 'Renamed' });

    expect(res.status).toBe(200);
    expect(owner.firstName).toBe('Renamed');
  });

  it('refuses an administrator on the own record too', async () => {
    const token = await login('admin@example.com');
    const admin = findUserByEmail('admin@example.com')!;

    const res = await patchUser(token, admin.id, { isActive: false });

    expect(res.status).toBe(400);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.USERS.MODERATION_SELF);
    expect(admin.isActive).toBe(true);
  });

  it('lets an administrator deactivate another account', async () => {
    const token = await login('admin@example.com');
    const target = findUserByEmail('user@example.com')!;

    const res = await patchUser(token, target.id, { isActive: false });

    expect(res.status).toBe(200);
    expect(target.isActive).toBe(false);
  });
});
