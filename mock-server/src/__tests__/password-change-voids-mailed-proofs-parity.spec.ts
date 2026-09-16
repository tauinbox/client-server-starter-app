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
const NEW_PASSWORD = 'Sunrise-Kettle-19';
const PENDING_EMAIL = 'moved-by-attacker@example.com';
const PENDING_TOKEN = 'pending-token-voids-parity';

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

function seedPendingEmailChange(email: string): void {
  const user = findUserByEmail(email);
  expect(user).toBeDefined();
  user!.pendingEmail = PENDING_EMAIL;
  user!.pendingEmailToken = PENDING_TOKEN;
  user!.pendingEmailExpiresAt = new Date(Date.now() + 86400000).toISOString();
  getState().pendingEmailTokens.set(PENDING_TOKEN, user!.id);
}

async function expectProofsDead(email: string, resetToken: string) {
  const user = findUserByEmail(email);
  expect(user!.pendingEmail).toBeNull();
  expect(user!.pendingEmailToken).toBeNull();
  expect(user!.pendingEmailExpiresAt).toBeNull();
  expect(getState().passwordResetTokens.has(resetToken)).toBe(false);
  expect(getState().pendingEmailTokens.has(PENDING_TOKEN)).toBe(false);

  // Pre-fix the kept link still took the account.
  const reset = await postAuth('reset-password', {
    token: resetToken,
    password: 'Amber-Signal-42'
  });
  expect(reset.status).toBe(400);
  expect(await reset.json()).toMatchObject({
    errorKey: ErrorKeys.AUTH.INVALID_RESET_TOKEN
  });

  // Pre-fix the confirmation link moved the address to the attacker.
  const confirm = await postAuth('profile/email/confirm', {
    token: PENDING_TOKEN
  });
  expect(confirm.status).toBe(400);
  expect(await confirm.json()).toMatchObject({
    errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED
  });
  expect(findUserByEmail(email)?.email).toBe(email);
}

describe('a password change voids the mailed proofs', () => {
  it('drops both proofs on PATCH /auth/profile', async () => {
    const accessToken = await login(USER_EMAIL);
    seedPendingEmailChange(USER_EMAIL);
    const resetToken = await issueResetToken(USER_EMAIL);

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        password: NEW_PASSWORD,
        currentPassword: SEED_PASSWORD
      })
    });
    expect(res.status).toBe(200);

    await expectProofsDead(USER_EMAIL, resetToken);
  });

  it('drops both proofs on PATCH /users/:id', async () => {
    const adminToken = await login(ADMIN_EMAIL);
    seedPendingEmailChange(USER_EMAIL);
    const resetToken = await issueResetToken(USER_EMAIL);
    const targetId = findUserByEmail(USER_EMAIL)!.id;

    const res = await fetch(`${baseUrl}/api/v1/users/${targetId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ password: NEW_PASSWORD })
    });
    expect(res.status).toBe(200);

    await expectProofsDead(USER_EMAIL, resetToken);
  });

  it('keeps both proofs when the patch carries no password', async () => {
    const accessToken = await login(USER_EMAIL);
    seedPendingEmailChange(USER_EMAIL);
    const resetToken = await issueResetToken(USER_EMAIL);

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ firstName: 'Renamed' })
    });
    expect(res.status).toBe(200);

    expect(getState().passwordResetTokens.has(resetToken)).toBe(true);
    expect(findUserByEmail(USER_EMAIL)?.pendingEmailToken).toBe(PENDING_TOKEN);
  });
});
