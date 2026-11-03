import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const email = 'user@example.com';

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

function verify(token: string): Promise<Response> {
  return postJson('verify-email', { token });
}

async function reset(): Promise<Response> {
  expect((await postJson('forgot-password', { email })).status).toBe(200);
  const [token] = [...getState().passwordResetTokens.keys()];
  return postJson('reset-password', { token, password: 'Quartz-Meadow-77' });
}

function confirmEmailChange(newEmail: string): Promise<Response> {
  const user = findUserByEmail(email)!;
  const token = 'pending-token-audit';
  user.pendingEmail = newEmail;
  user.pendingEmailToken = token;
  user.pendingEmailExpiresAt = new Date(Date.now() + 60_000).toISOString();
  getState().pendingEmailTokens.set(token, user.id);
  return postJson('profile/email/confirm', { token });
}

function setVerified(isEmailVerified: boolean): string {
  const user = findUserByEmail(email);
  expect(user).toBeDefined();
  user!.isEmailVerified = isEmailVerified;
  return user!.id;
}

function issueToken(token: string, expiresInMs: number): string {
  const userId = setVerified(false);
  getState().emailVerificationTokens.set(token, {
    userId,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString()
  });
  return userId;
}

function verifiedRows() {
  return getState().auditLogs.filter((row) => row.action === 'EMAIL_VERIFIED');
}

describe('verify-email audit row', () => {
  it('writes one EMAIL_VERIFIED row for a verified token', async () => {
    const userId = issueToken('valid-token', 60_000);

    const res = await verify('valid-token');

    expect(res.status).toBe(200);
    expect(verifiedRows()).toEqual([
      expect.objectContaining({
        actorId: userId,
        actorEmail: email,
        targetId: userId,
        targetType: 'User',
        details: { source: 'link' }
      })
    ]);
  });

  it('writes no row for an unknown or expired token', async () => {
    issueToken('expired-token', -1000);

    expect((await verify('unknown-token')).status).toBe(422);
    expect((await verify('expired-token')).status).toBe(422);
    expect(verifiedRows()).toEqual([]);
  });

  it('writes one row with source reset when a reset verifies the address', async () => {
    const userId = setVerified(false);

    expect((await reset()).status).toBe(200);
    expect(verifiedRows()).toEqual([
      expect.objectContaining({
        actorId: userId,
        actorEmail: email,
        targetId: userId,
        targetType: 'User',
        details: { source: 'reset' }
      })
    ]);
  });

  it('writes no row when a reset finds the address already verified', async () => {
    setVerified(true);

    expect((await reset()).status).toBe(200);
    expect(verifiedRows()).toEqual([]);
  });

  it('writes one row with source email_change when a confirmation verifies the address', async () => {
    const userId = setVerified(false);
    const newEmail = 'audit-moved@example.com';

    expect((await confirmEmailChange(newEmail)).status).toBe(200);
    expect(verifiedRows()).toEqual([
      expect.objectContaining({
        actorId: userId,
        actorEmail: newEmail,
        targetId: userId,
        targetType: 'User',
        details: { source: 'email_change' }
      })
    ]);
  });

  it('writes no row when a confirmation finds the account already verified', async () => {
    setVerified(true);

    expect((await confirmEmailChange('audit-moved@example.com')).status).toBe(
      200
    );
    expect(verifiedRows()).toEqual([]);
  });
});
