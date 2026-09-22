import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors server/test/super-target-guard.e2e-spec.ts: a delegated role that
// holds `update:User` and `delete:User` without conditions cannot change,
// delete or restore an account that holds the super role.

const SEED_PASSWORD = 'Password1';
const NEW_PASSWORD = 'Copper-Meadow-83';
const EDITOR_ROLE_ID = mockId('role-editor');

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
  delegateUserWrites();
});

function permissionId(actionSlug: string): string {
  const permission = [...getState().permissions.values()].find(
    (p) =>
      p.resourceId === mockId('res-users') && p.actionId === mockId(actionSlug)
  );
  if (!permission) {
    throw new Error(`Seed permission users/${actionSlug} missing`);
  }
  return permission.id;
}

// Puts user@example.com on the non-super `editor` role with unconditional
// `update:User` and `delete:User`.
function delegateUserWrites(): void {
  const state = getState();
  state.rolePermissions = [
    ...state.rolePermissions.filter((rp) => rp.roleId !== EDITOR_ROLE_ID),
    ...['act-update', 'act-delete'].map((action, index) => ({
      id: `rp-super-target-${index}`,
      roleId: EDITOR_ROLE_ID,
      permissionId: permissionId(action),
      conditions: null
    }))
  ];
  findUserByEmail('user@example.com')!.roles = ['editor'];
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

function call(token: string, method: string, path: string, body?: object) {
  return fetch(`${baseUrl}/api/v1/users/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function expectSuperTargetRefusal(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  expect(((await res.json()) as { errorKey?: string }).errorKey).toBe(
    ErrorKeys.USERS.SUPER_TARGET_FORBIDDEN
  );
}

describe('user writes on a super target parity', () => {
  it('refuses a password change on a super account by a delegated role', async () => {
    const token = await login('user@example.com');
    const target = findUserByEmail('admin@example.com')!;

    await expectSuperTargetRefusal(
      await call(token, 'PATCH', target.id, {
        password: NEW_PASSWORD,
        currentPassword: SEED_PASSWORD
      })
    );
    expect(target.password).toBe(SEED_PASSWORD);
    expect(getState().auditLogs.at(-1)).toMatchObject({
      action: 'PERMISSION_CHECK_FAILURE',
      targetId: target.id,
      details: { deniedAction: 'update', superTarget: true }
    });
  });

  it('refuses the super target before it reads the factor of the caller', async () => {
    const token = await login('user@example.com');
    const target = findUserByEmail('admin@example.com')!;

    await expectSuperTargetRefusal(
      await call(token, 'PATCH', target.id, { password: NEW_PASSWORD })
    );
  });

  it('refuses a deactivation of a super account by a delegated role', async () => {
    const token = await login('user@example.com');
    const target = findUserByEmail('admin@example.com')!;

    await expectSuperTargetRefusal(
      await call(token, 'PATCH', target.id, { isActive: false })
    );
    expect(target.isActive).toBe(true);
  });

  it('refuses a delete of a super account by a delegated role', async () => {
    const token = await login('user@example.com');
    const target = findUserByEmail('admin@example.com')!;

    await expectSuperTargetRefusal(await call(token, 'DELETE', target.id));
    expect(target.deletedAt).toBeNull();
  });

  it('refuses a restore of a super account by a delegated role', async () => {
    const token = await login('user@example.com');
    const target = findUserByEmail('admin@example.com')!;
    target.deletedAt = new Date().toISOString();

    await expectSuperTargetRefusal(
      await call(token, 'POST', `${target.id}/restore`)
    );
    expect(target.deletedAt).not.toBeNull();
  });

  it('lets a super actor change a super account', async () => {
    const token = await login('admin@example.com');
    const target = findUserByEmail('admin@example.com')!;

    const res = await call(token, 'PATCH', target.id, { firstName: 'Renamed' });

    expect(res.status).toBe(200);
    expect(target.firstName).toBe('Renamed');
  });

  it('lets the delegated role change an ordinary account', async () => {
    const token = await login('user@example.com');
    const target = findUserByEmail('user@example.com')!;

    const res = await call(token, 'PATCH', target.id, { firstName: 'Renamed' });

    expect(res.status).toBe(200);
    expect(target.firstName).toBe('Renamed');
  });
});
