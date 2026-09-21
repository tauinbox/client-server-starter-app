import type { Server } from 'http';
import { randomUUID } from 'crypto';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import type { ActiveSessionResponse } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';
import type { MockUser } from '../types';

// Mirrors server/test/active-sessions.e2e-spec.ts and SessionsController.

let server: Server;
let baseUrl: string;

const EMAIL = 'user@example.com';
const OTHER_EMAIL = 'admin@example.com';
const PASSWORD = 'Password1';
const OAUTH_ONLY_ID = '00000000-0000-4000-8000-00000000abcd';

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

type Device = { token: string; sessionId: string };

async function sessions(token: string): Promise<ActiveSessionResponse[]> {
  const res = await fetch(`${baseUrl}/api/v1/auth/sessions`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ActiveSessionResponse[];
}

async function withSessionId(token: string): Promise<Device> {
  const current = (await sessions(token)).find((s) => s.current);
  expect(current).toBeDefined();
  return { token, sessionId: current?.id ?? '' };
}

async function signIn(email: string, userAgent: string): Promise<Device> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': userAgent },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return withSessionId(body.tokens.access_token);
}

/** A provider sign-in, which is the only way into an account with no password. */
async function providerSignIn(userId: string): Promise<Device> {
  const dataRes = await fetch(`${baseUrl}/__control/oauth-data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  const { token } = (await dataRes.json()) as { token: string };
  const exchange = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
    method: 'POST',
    headers: { cookie: `oauth_data=${token}` }
  });
  expect(exchange.status).toBe(200);
  const body = (await exchange.json()) as { tokens: { access_token: string } };
  return withSessionId(body.tokens.access_token);
}

function revoke(
  caller: Device,
  target: string | null,
  body?: unknown,
  proof?: string
): Promise<Response> {
  const path = target === null ? '' : `/${target}`;
  return fetch(`${baseUrl}/api/v1/auth/sessions${path}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${caller.token}`,
      ...(proof ? { cookie: `reauth_proof=${proof}` } : {})
    },
    body: JSON.stringify(body ?? {})
  });
}

function profileStatus(device: Device): Promise<number> {
  return fetch(`${baseUrl}/api/v1/auth/profile`, {
    headers: { authorization: `Bearer ${device.token}` }
  }).then((res) => res.status);
}

function revokeAudits() {
  return getState().auditLogs.filter((row) => row.action === 'SESSION_REVOKE');
}

describe('GET /api/v1/auth/sessions', () => {
  it('lists every device, marks the caller and carries the user agent', async () => {
    const a = await signIn(EMAIL, 'Device-A');
    const b = await signIn(EMAIL, 'Device-B');

    const list = await sessions(a.token);

    expect(list.find((s) => s.id === a.sessionId)).toMatchObject({
      current: true,
      userAgent: 'Device-A'
    });
    expect(list.find((s) => s.id === b.sessionId)).toMatchObject({
      current: false,
      userAgent: 'Device-B'
    });
  });

  it('keeps the device across a token refresh', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Phone' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD })
    });
    const cookie = /refresh_token=[^;]+/.exec(
      res.headers.get('set-cookie') ?? ''
    )?.[0];
    const refreshed = await fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
      method: 'POST',
      headers: { cookie: cookie ?? '', 'user-agent': 'Other' }
    });
    const body = (await refreshed.json()) as {
      tokens: { access_token: string };
    };

    const list = await sessions(body.tokens.access_token);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ current: true, userAgent: 'Phone' });
  });
});

describe('DELETE /api/v1/auth/sessions/:sessionId', () => {
  it('refuses without a factor and ends nothing', async () => {
    const a = await signIn(EMAIL, 'Device-A');
    const b = await signIn(EMAIL, 'Device-B');

    const res = await revoke(a, b.sessionId);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { errorKey: string }).errorKey).toBe(
      ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    );
    await expect(profileStatus(b)).resolves.toBe(200);
  });

  it('ends the other device at once and keeps the caller signed in', async () => {
    const a = await signIn(EMAIL, 'Device-A');
    const b = await signIn(EMAIL, 'Device-B');

    const res = await revoke(a, b.sessionId, { currentPassword: PASSWORD });

    expect(res.status).toBe(200);
    await expect(profileStatus(b)).resolves.toBe(401);
    await expect(profileStatus(a)).resolves.toBe(200);
    expect(revokeAudits().map((row) => row.details)).toEqual([
      { scope: 'one', count: 1 }
    ]);
  });

  it('answers 404 for an unknown id and for a session of another account', async () => {
    const a = await signIn(EMAIL, 'Device-A');
    const foreign = await signIn(OTHER_EMAIL, 'Device-X');

    for (const id of [randomUUID(), foreign.sessionId]) {
      const res = await revoke(a, id, { currentPassword: PASSWORD });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { errorKey: string }).errorKey).toBe(
        ErrorKeys.AUTH.SESSION_NOT_FOUND
      );
    }
    await expect(profileStatus(foreign)).resolves.toBe(200);
  });

  it('refuses the session of the caller', async () => {
    const a = await signIn(EMAIL, 'Device-A');

    const res = await revoke(a, a.sessionId, { currentPassword: PASSWORD });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { errorKey: string }).errorKey).toBe(
      ErrorKeys.AUTH.SESSION_IS_CURRENT
    );
    await expect(profileStatus(a)).resolves.toBe(200);
  });

  it('rejects a malformed id the way ParseUUIDPipe does', async () => {
    const a = await signIn(EMAIL, 'Device-A');

    const res = await revoke(a, 'not-a-uuid', { currentPassword: PASSWORD });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe(
      'Validation failed (uuid is expected)'
    );
  });

  it('accepts the provider proof of an account with no password, once', async () => {
    const template = findUserByEmail(EMAIL) as MockUser;
    getState().users.set(OAUTH_ONLY_ID, {
      ...template,
      id: OAUTH_ONLY_ID,
      email: 'oauth-only@example.com',
      password: null
    });
    const caller = await providerSignIn(OAUTH_ONLY_ID);
    const phone = await providerSignIn(OAUTH_ONLY_ID);
    const desktop = await providerSignIn(OAUTH_ONLY_ID);

    const proofRes = await fetch(`${baseUrl}/__control/reauth-proof`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: OAUTH_ONLY_ID,
        operation: STEP_UP_OPERATION.SESSION_REVOKE
      })
    });
    const { token: proof } = (await proofRes.json()) as { token: string };

    const first = await revoke(caller, desktop.sessionId, {}, proof);
    const second = await revoke(caller, phone.sessionId, {}, proof);

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(((await second.json()) as { errorKey: string }).errorKey).toBe(
      ErrorKeys.AUTH.REAUTH_REQUIRED
    );
  });
});

describe('DELETE /api/v1/auth/sessions', () => {
  it('ends every other device and no other account', async () => {
    const a = await signIn(EMAIL, 'Device-A');
    const c = await signIn(EMAIL, 'Device-C');
    const d = await signIn(EMAIL, 'Device-D');
    const foreign = await signIn(OTHER_EMAIL, 'Device-Y');

    const refused = await revoke(a, null, { currentPassword: 'Wrong-00' });
    expect(refused.status).toBe(400);
    await expect(profileStatus(c)).resolves.toBe(200);

    const res = await revoke(a, null, { currentPassword: PASSWORD });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(2);
    await expect(profileStatus(c)).resolves.toBe(401);
    await expect(profileStatus(d)).resolves.toBe(401);
    await expect(profileStatus(a)).resolves.toBe(200);
    await expect(profileStatus(foreign)).resolves.toBe(200);
    expect((await sessions(a.token)).map((s) => s.id)).toEqual([a.sessionId]);
    expect(revokeAudits().map((row) => row.details)).toEqual([
      { scope: 'others', count: 2 }
    ]);
  });
});
