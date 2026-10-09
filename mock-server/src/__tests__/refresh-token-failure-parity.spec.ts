import type { Server } from 'http';
import {
  DEFAULT_SESSION_ABSOLUTE_MAX_MS,
  ErrorKeys
} from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockAuditLog } from '../types';
import { readErrorBody } from '../utils/error-body';

let server: Server;
let baseUrl: string;

const EMAIL = 'user@example.com';
const PASSWORD = 'Password1';

type Session = { userId: string; refreshCookie: string };

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

function refreshCookieOf(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const match = /refresh_token=([^;]+)/.exec(raw);
  expect(match).not.toBeNull();
  return `refresh_token=${match?.[1] ?? ''}`;
}

async function signIn(): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { id: string } };
  return { userId: body.user.id, refreshCookie: refreshCookieOf(res) };
}

function refresh(session: Session): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
    method: 'POST',
    headers: { cookie: session.refreshCookie }
  });
}

function setActive(userId: string, isActive: boolean): void {
  const user = getState().users.get(userId);
  expect(user).toBeDefined();
  user!.isActive = isActive;
}

async function ageSession(userId: string, ageMs: number): Promise<void> {
  const res = await fetch(`${baseUrl}/__control/age-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, ageMs })
  });
  expect(res.status).toBe(200);
}

function auditRows(action: string): MockAuditLog[] {
  return getState().auditLogs.filter((row) => row.action === action);
}

describe('refresh-token failure parity', () => {
  it('answers a missing cookie with the refresh-token-required key', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
      method: 'POST'
    });
    expect(res.status).toBe(401);
    expect(await readErrorBody(res)).toEqual({
      message: 'Refresh token is required',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.REFRESH_TOKEN_REQUIRED
    });
    expect(auditRows('TOKEN_REFRESH_FAILURE')).toHaveLength(0);
  });

  it('answers a deactivated account with the deactivated envelope', async () => {
    const session = await signIn();
    setActive(session.userId, false);

    const res = await refresh(session);
    expect(res.status).toBe(401);
    expect(await readErrorBody(res)).toEqual({
      message: 'User account is deactivated',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.USER_DEACTIVATED
    });

    const rows = auditRows('TOKEN_REFRESH_FAILURE');
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toEqual({ reason: 'user_deactivated' });
    expect(rows[0].actorEmail).toBe(EMAIL);
  });

  it('answers a missing account with the not-found envelope', async () => {
    const session = await signIn();
    const user = getState().users.get(session.userId);
    expect(user).toBeDefined();
    user!.deletedAt = new Date().toISOString();

    const res = await refresh(session);
    expect(res.status).toBe(401);
    expect(await readErrorBody(res)).toEqual({
      message: 'User not found',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.USER_NOT_FOUND
    });

    const rows = auditRows('TOKEN_REFRESH_FAILURE');
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toEqual({ reason: 'user_not_found' });
  });

  it('keeps a refused deactivated token for the reuse detector', async () => {
    const phone = await signIn();
    const desktop = await signIn();
    setActive(phone.userId, false);

    expect((await refresh(phone)).status).toBe(401);

    const replay = await refresh(phone);
    expect(replay.status).toBe(401);
    expect(await readErrorBody(replay)).toEqual({
      message: 'Invalid refresh token',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    });
    expect(auditRows('TOKEN_REUSE_DETECTED')).toHaveLength(1);

    // The replay revoked every session of the account, so the other device is
    // dead even after the account comes back.
    setActive(phone.userId, true);
    const other = await refresh(desktop);
    expect(other.status).toBe(401);
    expect(await readErrorBody(other)).toEqual({
      message: 'Invalid refresh token',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    });
  });

  it('leaves the other device alone when the token is not replayed', async () => {
    const phone = await signIn();
    const desktop = await signIn();
    setActive(phone.userId, false);

    expect((await refresh(phone)).status).toBe(401);
    expect(auditRows('TOKEN_REUSE_DETECTED')).toHaveLength(0);

    setActive(phone.userId, true);
    expect((await refresh(desktop)).status).toBe(200);
  });

  it('refuses a refresh past the absolute session lifetime', async () => {
    const session = await signIn();
    await ageSession(session.userId, DEFAULT_SESSION_ABSOLUTE_MAX_MS);

    const res = await refresh(session);
    expect(res.status).toBe(401);
    expect(await readErrorBody(res)).toEqual({
      message: 'Session has reached its maximum duration. Please log in again.',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.SESSION_EXPIRED
    });

    const rows = auditRows('TOKEN_REFRESH_FAILURE');
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toEqual({
      reason: 'session_absolute_lifetime_exceeded'
    });
  });

  it('ends the whole session at the cap, so a replay is not read as reuse', async () => {
    const session = await signIn();
    await ageSession(session.userId, DEFAULT_SESSION_ABSOLUTE_MAX_MS);

    expect((await refresh(session)).status).toBe(401);

    const replay = await refresh(session);
    expect(replay.status).toBe(401);
    expect(await readErrorBody(replay)).toEqual({
      message: 'Invalid refresh token',
      statusCode: 401,
      errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    });
    expect(auditRows('TOKEN_REUSE_DETECTED')).toHaveLength(0);
  });

  it('carries the session start over a rotation', async () => {
    const session = await signIn();
    const half = DEFAULT_SESSION_ABSOLUTE_MAX_MS / 2;

    await ageSession(session.userId, half);
    const rotated = await refresh(session);
    expect(rotated.status).toBe(200);

    const next: Session = {
      userId: session.userId,
      refreshCookie: refreshCookieOf(rotated)
    };

    // The second half tips the session past the cap only if the rotation kept
    // the original start. A re-stamped start would answer 200 here.
    await ageSession(session.userId, half);
    const res = await refresh(next);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.SESSION_EXPIRED
    });
  });

  it('does not clear the refresh cookie on the reuse path', async () => {
    const session = await signIn();

    const rotated = await refresh(session);
    expect(rotated.status).toBe(200);
    const next: Session = {
      userId: session.userId,
      refreshCookie: refreshCookieOf(rotated)
    };
    expect((await refresh(next)).status).toBe(200);

    const replay = await refresh(session);
    expect(auditRows('TOKEN_REUSE_DETECTED')).toHaveLength(1);
    expect(replay.status).toBe(401);
    // Named, so that no other cookie on the response can satisfy it.
    expect(replay.headers.get('set-cookie') ?? '').not.toContain(
      'refresh_token='
    );
  });

  describe('lost rotation response', () => {
    function shiftLastActive(ms: number): void {
      const lastActive = getState().sessionLastActive;
      for (const [sid, at] of lastActive.entries())
        lastActive.set(sid, at - ms);
    }

    it('ends only the replayed session', async () => {
      const phone = await signIn();
      const desktop = await signIn();

      expect((await refresh(phone)).status).toBe(200);

      const replay = await refresh(phone);
      expect(replay.status).toBe(401);
      expect(await readErrorBody(replay)).toEqual({
        message: 'Invalid refresh token',
        statusCode: 401,
        errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
      });
      expect(auditRows('TOKEN_REUSE_DETECTED')).toHaveLength(0);
      const rows = auditRows('TOKEN_REFRESH_FAILURE');
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toEqual({
        reason: 'lost_response_replay',
        sessionId: expect.any(String),
        replayAgeMs: expect.any(Number),
        sameIp: true
      });
      expect(rows[0].actorId).toBe(phone.userId);

      // The replay ended the chain of the phone and nothing else.
      expect(getState().refreshTokens.size).toBe(1);
      expect((await refresh(desktop)).status).toBe(200);
    });

    // A tab closed during the refresh replays the old cookie on the next visit,
    // which can be a day later.
    it('ends only the replayed session a day after the rotation', async () => {
      const phone = await signIn();
      const desktop = await signIn();

      expect((await refresh(phone)).status).toBe(200);
      shiftLastActive(24 * 60 * 60 * 1000);

      expect((await refresh(phone)).status).toBe(401);
      expect(auditRows('TOKEN_REUSE_DETECTED')).toHaveLength(0);
      const details = auditRows('TOKEN_REFRESH_FAILURE')[0].details;
      expect(details).toMatchObject({
        reason: 'lost_response_replay',
        sameIp: true
      });
      const dayMs = 24 * 60 * 60 * 1000;
      expect(details?.['replayAgeMs']).toBeGreaterThanOrEqual(dayMs);
      expect(details?.['replayAgeMs']).toBeLessThan(dayMs + 60_000);
      expect((await refresh(desktop)).status).toBe(200);
    });

    it('purges every session when an older ancestor is replayed', async () => {
      const phone = await signIn();
      const desktop = await signIn();

      const rotated = await refresh(phone);
      expect(rotated.status).toBe(200);
      const next: Session = {
        userId: phone.userId,
        refreshCookie: refreshCookieOf(rotated)
      };
      expect((await refresh(next)).status).toBe(200);
      const sessionId = getState().refreshSessions.get(
        phone.refreshCookie.replace('refresh_token=', '')
      );

      expect((await refresh(phone)).status).toBe(401);
      const reuse = auditRows('TOKEN_REUSE_DETECTED');
      expect(reuse).toHaveLength(1);
      expect(sessionId).toBeDefined();
      expect(reuse[0].details).toEqual({ sessionId });
      expect((await refresh(desktop)).status).toBe(401);
    });
  });
});
