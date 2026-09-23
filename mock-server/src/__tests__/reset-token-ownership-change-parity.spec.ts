import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const USER_EMAIL = 'user@example.com';
const ADMIN_EMAIL = 'admin@example.com';
const SEED_PASSWORD = 'Password1';
const MOVED_EMAIL = 'moved-owner@example.com';
const PENDING_TOKEN = 'pending-token-ownership-parity';

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

function postAuth(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function adminRequest(
  method: string,
  path: string,
  accessToken: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/users/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function login(email: string): Promise<string> {
  const res = await postAuth('login', { email, password: SEED_PASSWORD });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function issueResetToken(email: string): Promise<string> {
  const res = await postAuth('forgot-password', { email });
  expect(res.status).toBe(200);
  const [token] = [...getState().passwordResetTokens.keys()];
  expect(token).toBeDefined();
  return token;
}

async function expectResetRefused(resetToken: string): Promise<void> {
  expect(getState().passwordResetTokens.has(resetToken)).toBe(false);
  const reset = await postAuth('reset-password', {
    token: resetToken,
    password: 'Amber-Signal-42'
  });
  expect(reset.status).toBe(400);
  expect(await reset.json()).toMatchObject({
    errorKey: ErrorKeys.AUTH.INVALID_RESET_TOKEN
  });
}

describe('a reset link dies with an ownership change', () => {
  it('refuses the link after the owner confirms an email change', async () => {
    const resetToken = await issueResetToken(USER_EMAIL);
    const user = findUserByEmail(USER_EMAIL)!;
    user.pendingEmail = MOVED_EMAIL;
    user.pendingEmailToken = PENDING_TOKEN;
    user.pendingEmailExpiresAt = new Date(Date.now() + 86400000).toISOString();
    getState().pendingEmailTokens.set(PENDING_TOKEN, user.id);

    const confirm = await postAuth('profile/email/confirm', {
      token: PENDING_TOKEN
    });
    expect(confirm.status).toBe(200);
    expect(user.email).toBe(MOVED_EMAIL);

    await expectResetRefused(resetToken);
  });

  it('refuses the link after an administrator moves the address', async () => {
    const adminToken = await login(ADMIN_EMAIL);
    const resetToken = await issueResetToken(USER_EMAIL);
    const user = findUserByEmail(USER_EMAIL)!;

    const res = await adminRequest('PATCH', user.id, adminToken, {
      email: MOVED_EMAIL,
      currentPassword: SEED_PASSWORD
    });
    expect(res.status).toBe(200);

    await expectResetRefused(resetToken);
    expect(user.isEmailVerified).toBe(false);
  });

  it('refuses the link after a deactivation and a reactivation', async () => {
    const adminToken = await login(ADMIN_EMAIL);
    const resetToken = await issueResetToken(USER_EMAIL);
    const userId = findUserByEmail(USER_EMAIL)!.id;

    for (const isActive of [false, true]) {
      const res = await adminRequest('PATCH', userId, adminToken, {
        isActive
      });
      expect(res.status).toBe(200);
    }

    await expectResetRefused(resetToken);
  });

  it('refuses the link after a soft delete and a restore', async () => {
    const adminToken = await login(ADMIN_EMAIL);
    const resetToken = await issueResetToken(USER_EMAIL);
    const userId = findUserByEmail(USER_EMAIL)!.id;

    const removed = await adminRequest('DELETE', userId, adminToken);
    expect(removed.ok).toBe(true);
    const restored = await adminRequest(
      'POST',
      `${userId}/restore`,
      adminToken
    );
    expect(restored.ok).toBe(true);

    await expectResetRefused(resetToken);
  });

  it('keeps the link when the patch changes nothing the link depends on', async () => {
    const adminToken = await login(ADMIN_EMAIL);
    const resetToken = await issueResetToken(USER_EMAIL);
    const userId = findUserByEmail(USER_EMAIL)!.id;

    const res = await adminRequest('PATCH', userId, adminToken, {
      firstName: 'Renamed'
    });
    expect(res.status).toBe(200);

    expect(getState().passwordResetTokens.has(resetToken)).toBe(true);
  });
});
