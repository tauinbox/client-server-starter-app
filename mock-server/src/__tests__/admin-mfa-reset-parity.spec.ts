import type { Server } from 'http';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';
import type { MockUser } from '../types';

// Mirrors server/test/admin-mfa-reset.e2e-spec.ts: an administrator resets the
// two-factor enrolment of another user after a step-up of the administrator.

const SEED_PASSWORD = 'Password1';
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
});

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

function reset(token: string, id: string, body: object) {
  return fetch(`${baseUrl}/api/v1/users/${id}/mfa/reset`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

function enrol(user: MockUser): void {
  user.totpSecret = 'not-a-real-secret';
  user.totpEnabledAt = new Date().toISOString();
  user.totpRecoveryCodes = ['spent-hash'];
  user.totpLastUsedStep = 1;
}

async function errorKeyOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { errorKey?: string }).errorKey;
}

function auditRows(action: string) {
  return getState().auditLogs.filter((row) => row.action === action);
}

describe('POST /api/v1/users/:id/mfa/reset parity', () => {
  it('clears the factor, ends the sessions of the target and audits the administrator', async () => {
    const target = findUserByEmail('user@example.com')!;
    await login('user@example.com');
    enrol(target);
    const token = await login('admin@example.com');

    const res = await reset(token, target.id, {
      currentPassword: SEED_PASSWORD
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { mfaEnabled: boolean }).mfaEnabled).toBe(
      false
    );
    expect(target.totpSecret).toBeNull();
    expect(target.totpEnabledAt).toBeNull();
    expect(target.totpRecoveryCodes).toBeNull();
    expect(target.totpLastUsedStep).toBeNull();
    expect(target.tokenRevokedAt).not.toBeNull();
    expect(
      [...getState().refreshTokens.values()].filter((id) => id === target.id)
    ).toHaveLength(0);
    expect(auditRows('MFA_RESET_BY_ADMIN').at(-1)).toMatchObject({
      actorEmail: 'admin@example.com',
      targetId: target.id
    });
  });

  it('refuses without a step-up of the caller', async () => {
    const target = findUserByEmail('user@example.com')!;
    enrol(target);
    const token = await login('admin@example.com');

    const res = await reset(token, target.id, {});

    expect(res.status).toBe(400);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD);
    expect(target.totpEnabledAt).not.toBeNull();
    expect(auditRows('STEP_UP_FAILURE').at(-1)?.details).toMatchObject({
      operation: STEP_UP_OPERATION.USER_CREDENTIAL_CHANGE
    });
  });

  it('refuses a self-target', async () => {
    const admin = findUserByEmail('admin@example.com')!;
    const token = await login('admin@example.com');
    enrol(admin);

    const res = await reset(token, admin.id, {
      currentPassword: SEED_PASSWORD
    });

    expect(res.status).toBe(400);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.USERS.MFA_RESET_SELF);
    expect(admin.totpEnabledAt).not.toBeNull();
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
        id: 'rp-mfa-reset',
        roleId: EDITOR_ROLE_ID,
        permissionId: updateUser.id,
        conditions: null
      }
    ];
    findUserByEmail('user@example.com')!.roles = ['editor'];
    const admin = findUserByEmail('admin@example.com')!;
    enrol(admin);
    const token = await login('user@example.com');

    const res = await reset(token, admin.id, {
      currentPassword: SEED_PASSWORD
    });

    expect(res.status).toBe(403);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.USERS.SUPER_TARGET_FORBIDDEN);
    expect(admin.totpEnabledAt).not.toBeNull();
  });

  it('refuses an account with no factor before the step-up', async () => {
    const target = findUserByEmail('user@example.com')!;
    const token = await login('admin@example.com');
    const before = auditRows('STEP_UP_FAILURE').length;

    const res = await reset(token, target.id, {
      currentPassword: 'Wrong-Password-00'
    });

    expect(res.status).toBe(400);
    expect(await errorKeyOf(res)).toBe(ErrorKeys.AUTH.MFA_NOT_ENABLED);
    expect(auditRows('STEP_UP_FAILURE')).toHaveLength(before);
  });
});
