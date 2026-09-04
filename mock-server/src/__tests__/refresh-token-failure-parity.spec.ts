import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockAuditLog } from '../types';

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

function auditRows(action: string): MockAuditLog[] {
  return getState().auditLogs.filter((row) => row.action === action);
}

describe('refresh-token failure parity', () => {
  it('answers a deactivated account with the deactivated envelope', async () => {
    const session = await signIn();
    setActive(session.userId, false);

    const res = await refresh(session);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
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
    expect(await res.json()).toEqual({
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
    expect(await replay.json()).toEqual({
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
    expect(await other.json()).toEqual({
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

  it('does not clear the refresh cookie on the reuse path', async () => {
    const session = await signIn();

    const rotated = await refresh(session);
    expect(rotated.status).toBe(200);

    const replay = await refresh(session);
    expect(replay.status).toBe(401);
    // Another cookie (the anonymous id) rides on every response, so the
    // assertion has to name the refresh cookie.
    expect(replay.headers.get('set-cookie') ?? '').not.toContain(
      'refresh_token='
    );
  });
});
