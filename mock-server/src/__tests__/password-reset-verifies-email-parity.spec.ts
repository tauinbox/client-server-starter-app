import type { Server } from 'http';
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

describe('password reset verifies the email', () => {
  beforeEach(() => {
    const user = findUserByEmail(email);
    expect(user).toBeDefined();
    user!.isEmailVerified = false;
  });

  it('lets a never-verified account log in right after a reset', async () => {
    const token = await issueResetToken();

    const reset = await postJson('reset-password', {
      token,
      password: newPassword
    });
    expect(reset.status).toBe(200);
    expect(findUserByEmail(email)?.isEmailVerified).toBe(true);

    // Pre-fix this was 403 EMAIL_NOT_VERIFIED.
    const login = await postJson('login', { email, password: newPassword });
    expect(login.status).toBe(200);
  });

  it('verifies the address on the row, never an in-flight pending one', async () => {
    const pendingEmail = 'pending-parity@example.com';
    const pendingToken = 'pending-token-parity';
    const user = findUserByEmail(email);
    user!.pendingEmail = pendingEmail;
    user!.pendingEmailToken = pendingToken;
    user!.pendingEmailExpiresAt = new Date(Date.now() + 1800000).toISOString();
    getState().pendingEmailTokens.set(pendingToken, user!.id);

    const token = await issueResetToken();
    const reset = await postJson('reset-password', {
      token,
      password: newPassword
    });
    expect(reset.status).toBe(200);

    const after = findUserByEmail(email);
    expect(after?.email).toBe(email);
    expect(after?.isEmailVerified).toBe(true);
    expect(after?.pendingEmail).toBeNull();
    expect(after?.pendingEmailToken).toBeNull();
    expect(after?.pendingEmailExpiresAt).toBeNull();
    expect(getState().pendingEmailTokens.has(pendingToken)).toBe(false);
  });
});
