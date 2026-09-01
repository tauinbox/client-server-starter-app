import type { Server } from 'http';
import {
  ErrorKeys,
  RESET_TOKEN_EXPIRY_MS,
  VERIFICATION_TOKEN_EXPIRY_MS
} from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const email = 'user@example.com';
const newPassword = 'NewPassword1';

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

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function issueResetToken(): Promise<string> {
  const res = await postJson('forgot-password', { email });
  expect(res.status).toBe(200);

  const [token] = [...getState().passwordResetTokens.keys()];
  expect(token).toBeDefined();
  return token;
}

async function issueVerificationToken(): Promise<string> {
  const user = findUserByEmail(email);
  expect(user).toBeDefined();
  user!.isEmailVerified = false;

  const res = await postJson('resend-verification', { email });
  expect(res.status).toBe(200);

  const [token] = [...getState().emailVerificationTokens.keys()];
  expect(token).toBeDefined();
  return token;
}

function ageToken(map: Map<string, { expiresAt: string }>, token: string) {
  const issued = map.get(token);
  expect(issued).toBeDefined();
  issued!.expiresAt = new Date(Date.now() - 1000).toISOString();
}

describe('mailed tokens carry the deadline the server enforces', () => {
  it('issues a reset token that expires 30 minutes out', async () => {
    const before = Date.now();
    const token = await issueResetToken();

    const expiresAt = new Date(
      getState().passwordResetTokens.get(token)!.expiresAt
    ).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + RESET_TOKEN_EXPIRY_MS);
    expect(expiresAt).toBeLessThanOrEqual(
      Date.now() + RESET_TOKEN_EXPIRY_MS + 1000
    );
  });

  it('issues a verification token that expires 24 hours out', async () => {
    const before = Date.now();
    const token = await issueVerificationToken();

    const expiresAt = new Date(
      getState().emailVerificationTokens.get(token)!.expiresAt
    ).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(
      before + VERIFICATION_TOKEN_EXPIRY_MS
    );
    expect(expiresAt).toBeLessThanOrEqual(
      Date.now() + VERIFICATION_TOKEN_EXPIRY_MS + 1000
    );
  });

  it('refuses an aged reset token and leaves the password alone', async () => {
    const token = await issueResetToken();
    ageToken(getState().passwordResetTokens, token);

    const res = await postJson('reset-password', {
      token,
      password: newPassword
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Password reset token has expired. Please request a new one.',
      errorKey: ErrorKeys.AUTH.RESET_TOKEN_EXPIRED
    });

    const login = await postJson('login', { email, password: newPassword });
    expect(login.status).toBe(401);
  });

  it('refuses an aged verification token and leaves the flag alone', async () => {
    const token = await issueVerificationToken();
    ageToken(getState().emailVerificationTokens, token);

    const res = await postJson('verify-email', { token });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Verification token has expired. Please request a new one.',
      errorKey: ErrorKeys.AUTH.VERIFICATION_TOKEN_EXPIRED
    });
    expect(findUserByEmail(email)?.isEmailVerified).toBe(false);
  });

  it('still accepts a token that is inside its deadline', async () => {
    const token = await issueResetToken();

    const res = await postJson('reset-password', {
      token,
      password: newPassword
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /__control/expire-token', () => {
  function expireToken(token: string): Promise<Response> {
    return fetch(`${baseUrl}/__control/expire-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });
  }

  it('ages a reset token so the route refuses it', async () => {
    const token = await issueResetToken();
    expect((await expireToken(token)).status).toBe(200);

    const res = await postJson('reset-password', {
      token,
      password: newPassword
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Password reset token has expired. Please request a new one.',
      errorKey: ErrorKeys.AUTH.RESET_TOKEN_EXPIRED
    });
  });

  it('ages a verification token so the route refuses it', async () => {
    const token = await issueVerificationToken();
    expect((await expireToken(token)).status).toBe(200);

    const res = await postJson('verify-email', { token });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Verification token has expired. Please request a new one.',
      errorKey: ErrorKeys.AUTH.VERIFICATION_TOKEN_EXPIRED
    });
  });

  it('answers 404 for an unknown token', async () => {
    expect((await expireToken('no-such-token')).status).toBe(404);
  });

  it('answers 400 when the body carries no token', async () => {
    const res = await fetch(`${baseUrl}/__control/expire-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(400);
  });
});
