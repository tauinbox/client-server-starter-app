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

function verify(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/verify-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  });
}

function issueToken(token: string, expiresInMs: number): string {
  const user = findUserByEmail(email);
  expect(user).toBeDefined();
  user!.isEmailVerified = false;
  getState().emailVerificationTokens.set(token, {
    userId: user!.id,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString()
  });
  return user!.id;
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
});
