import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const email = 'user@example.com';
const adminEmail = 'admin@example.com';
const password = 'Password1';
const newEmail = 'moved@example.com';

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

async function login(userEmail: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: userEmail, password })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function initiateEmailChange(): Promise<string> {
  const accessToken = await login(email);
  const res = await fetch(`${baseUrl}/api/v1/auth/profile/email/initiate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ newEmail, currentPassword: password })
  });
  expect(res.status).toBe(200);

  const token = findUserByEmail(email)?.pendingEmailToken;
  expect(token).toBeTruthy();
  return token as string;
}

function confirm(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/profile/email/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  });
}

const invalidTokenBody = {
  message: 'Invalid or expired email-change token',
  errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED,
  statusCode: 400
};

describe('confirm-email-change against a deactivated account', () => {
  it('refuses the confirmation once the account is deactivated', async () => {
    const token = await initiateEmailChange();
    findUserByEmail(email)!.isActive = false;

    const res = await confirm(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(invalidTokenBody);
    expect(findUserByEmail(email)?.email).toBe(email);
    expect(findUserByEmail(email)?.isEmailVerified).toBe(true);
  });

  it('answers the deactivated case exactly like an unknown token', async () => {
    const token = await initiateEmailChange();
    findUserByEmail(email)!.isActive = false;

    const deactivated = await confirm(token);
    const unknown = await confirm('no-such-email-change-token');

    expect(deactivated.status).toBe(unknown.status);
    expect(await deactivated.json()).toEqual(await unknown.json());
  });

  it('cancels the pending change when an administrator deactivates', async () => {
    const token = await initiateEmailChange();
    const targetId = findUserByEmail(email)!.id;
    const adminToken = await login(adminEmail);

    const patched = await fetch(`${baseUrl}/api/v1/users/${targetId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ isActive: false })
    });
    expect(patched.status).toBe(200);

    const target = findUserByEmail(email)!;
    expect(target.pendingEmail).toBeNull();
    expect(target.pendingEmailToken).toBeNull();
    expect(target.pendingEmailExpiresAt).toBeNull();
    expect(getState().pendingEmailTokens.has(token)).toBe(false);

    const res = await confirm(token);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(invalidTokenBody);
  });
});
