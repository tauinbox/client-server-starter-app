import type { Server } from 'http';
import { MAX_FAILED_ATTEMPTS } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const email = 'user@example.com';
const password = 'Password1';
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

async function lockAccount(): Promise<void> {
  for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
    await postJson('login', { email, password: 'wrong-password' });
  }
  expect(findUserByEmail(email)?.lockedUntil).not.toBeNull();
}

async function issueResetToken(): Promise<string> {
  const res = await postJson('forgot-password', { email });
  expect(res.status).toBe(200);

  const [token] = [...getState().passwordResetTokens.keys()];
  expect(token).toBeDefined();
  return token;
}

describe('lockout recovery', () => {
  it('accepts the new password right after a reset on a locked account', async () => {
    await lockAccount();
    const token = await issueResetToken();

    const reset = await postJson('reset-password', {
      token,
      password: newPassword
    });
    expect(reset.status).toBe(200);

    const user = findUserByEmail(email);
    expect(user?.failedLoginAttempts).toBe(0);
    expect(user?.lockedUntil).toBeNull();

    const login = await postJson('login', { email, password: newPassword });
    expect(login.status).toBe(200);
  });

  it('restarts the counter once the lock window has elapsed', async () => {
    await lockAccount();

    const locked = findUserByEmail(email);
    expect(locked).toBeDefined();
    locked!.lockedUntil = new Date(Date.now() - 1000).toISOString();

    const res = await postJson('login', { email, password: 'wrong-password' });
    expect(res.status).toBe(401);

    const user = findUserByEmail(email);
    expect(user?.failedLoginAttempts).toBe(1);
    expect(user?.lockedUntil).toBeNull();
  });

  it('keeps rejecting with 423 while the lock window is open', async () => {
    await lockAccount();

    const res = await postJson('login', { email, password });
    expect(res.status).toBe(423);
    expect(findUserByEmail(email)?.failedLoginAttempts).toBe(
      MAX_FAILED_ATTEMPTS
    );
  });
});
