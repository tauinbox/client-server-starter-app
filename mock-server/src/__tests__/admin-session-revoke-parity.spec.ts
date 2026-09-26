import type { Server } from 'http';
import { randomUUID } from 'crypto';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors server/test/admin-session-revoke.e2e-spec.ts: an administrator ends
// every session of another user.

const SEED_PASSWORD = 'Password1';
const EDITOR_ROLE_ID = mockId('role-editor');

type Session = { accessToken: string; refreshCookie: string };

let server: Server;
let baseUrl: string;

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

async function signIn(email: string): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD })
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

function revoke(token: string, id: string) {
  return fetch(`${baseUrl}/api/v1/users/${id}/sessions/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  });
}

function profile(session: Session) {
  return fetch(`${baseUrl}/api/v1/auth/profile`, {
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
}

function refresh(session: Session) {
  return fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
    method: 'POST',
    headers: { cookie: session.refreshCookie }
  });
}

async function errorKeyOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { errorKey?: string }).errorKey;
}

function revokeRows() {
  return getState().auditLogs.filter((row) => row.action === 'SESSION_REVOKE');
}

describe('POST /api/v1/users/:id/sessions/revoke parity', () => {
  it('ends every session of the target, keeps the caller signed in and audits', async () => {
    const target = findUserByEmail('user@example.com')!;
    const first = await signIn('user@example.com');
    const second = await signIn('user@example.com');
    const admin = await signIn('admin@example.com');

    const res = await revoke(admin.accessToken, target.id);

    expect(res.status).toBe(200);
    expect(target.tokenRevokedAt).not.toBeNull();
    expect((await profile(first)).status).toBe(401);
    expect((await profile(second)).status).toBe(401);
    const refused = await refresh(first);
    expect(refused.status).toBe(401);
    expect(await errorKeyOf(refused)).toBe(
      ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    );
    expect((await profile(admin)).status).toBe(200);
    expect(revokeRows().at(-1)).toMatchObject({
      actorEmail: 'admin@example.com',
      targetId: target.id,
      details: { scope: 'all', source: 'admin' }
    });
  });

  it('refuses a self-target and keeps the session', async () => {
    const admin = await signIn('admin@example.com');

    const res = await revoke(
      admin.accessToken,
      findUserByEmail('admin@example.com')!.id
    );

    expect(res.status).toBe(400);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.USERS.SESSION_REVOKE_SELF);
    expect((await profile(admin)).status).toBe(200);
  });

  it('refuses a super target for a non-super caller', async () => {
    const state = getState();
    const updateUser = [...state.permissions.values()].find(
      (p) =>
        p.resourceId === mockId('res-users') &&
        p.actionId === mockId('act-update')
    )!;
    state.rolePermissions = [
      ...state.rolePermissions.filter((rp) => rp.roleId !== EDITOR_ROLE_ID),
      {
        id: 'rp-session-revoke',
        roleId: EDITOR_ROLE_ID,
        permissionId: updateUser.id,
        conditions: null
      }
    ];
    findUserByEmail('user@example.com')!.roles = ['editor'];
    const admin = await signIn('admin@example.com');
    const editor = await signIn('user@example.com');

    const res = await revoke(
      editor.accessToken,
      findUserByEmail('admin@example.com')!.id
    );

    expect(res.status).toBe(403);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.USERS.SUPER_TARGET_FORBIDDEN);
    expect((await profile(admin)).status).toBe(200);
  });

  it('refuses a caller without update:User', async () => {
    const admin = await signIn('admin@example.com');
    const user = await signIn('user@example.com');

    const res = await revoke(
      user.accessToken,
      findUserByEmail('admin@example.com')!.id
    );

    expect(res.status).toBe(403);
    expect((await profile(admin)).status).toBe(200);
  });

  it('answers 404 for an unknown user', async () => {
    const admin = await signIn('admin@example.com');

    const res = await revoke(admin.accessToken, randomUUID());

    expect(res.status).toBe(404);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.USERS.NOT_FOUND);
  });
});
