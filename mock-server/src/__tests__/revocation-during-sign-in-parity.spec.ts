import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import type { ActiveSessionResponse } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

// The server keeps a session alive when its row commits after a revocation
// deleted the rows. The mock cannot reach that order, so the test stamps the
// revocation after the session start by hand, and expects the server answers.
let server: Server;
let baseUrl: string;

const USER_EMAIL = 'user@example.com';
const SEED_PASSWORD = 'Password1';

type Session = { accessToken: string; refreshCookie: string };

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function signIn(): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: USER_EMAIL, password: SEED_PASSWORD })
  });

  expect(res.status).toBe(200);
  const match = /refresh_token=([^;]+)/.exec(
    res.headers.get('set-cookie') ?? ''
  );

  expect(match).not.toBeNull();
  const body = (await res.json()) as { tokens: { access_token: string } };

  return {
    accessToken: body.tokens.access_token,
    refreshCookie: `refresh_token=${match?.[1] ?? ''}`
  };
}

/** Stamps a revocation one millisecond after the start of every session. */
function revokeAfterSessionStart(): void {
  const starts = [...getState().sessionStarts.values()];
  const user = findUserByEmail(USER_EMAIL)!;

  user.tokenRevokedAt = new Date(Math.max(...starts) + 1).toISOString();
}

function refresh(session: Session): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
    method: 'POST',
    headers: { cookie: session.refreshCookie }
  });
}

function listSessions(session: Session): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/sessions`, {
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
}

describe('a session that started before the last revocation', () => {
  it('refuses its refresh and ends it', async () => {
    const session = await signIn();

    revokeAfterSessionStart();

    const first = await refresh(session);

    expect(first.status).toBe(401);
    expect(((await first.json()) as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    );

    expect((await refresh(session)).status).toBe(401);
  });

  it('refuses its access token', async () => {
    const session = await signIn();

    revokeAfterSessionStart();

    const res = await listSessions(session);

    expect(res.status).toBe(401);
    expect(((await res.json()) as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.TOKEN_REVOKED
    );
  });

  it('is not listed beside a session that started after the revocation', async () => {
    await signIn();
    revokeAfterSessionStart();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const later = await signIn();

    const res = await listSessions(later);

    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as ActiveSessionResponse[]).map((s) => s.current)
    ).toEqual([true]);
    expect((await refresh(later)).status).toBe(200);
  });
});
