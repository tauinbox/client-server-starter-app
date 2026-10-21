import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors server/test/authorization-refusal-audit.e2e-spec.ts: every
// authorization refusal writes one row with the caller ip.

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
  delegate();
});

afterEach(() => {
  delete process.env['MFA_REQUIRED_FOR_ADMINS'];
});

function permissionId(actionSlug: string, resourceSlug: string): string {
  const permission = [...getState().permissions.values()].find(
    (p) =>
      p.resourceId === mockId(resourceSlug) && p.actionId === mockId(actionSlug)
  );
  if (!permission) {
    throw new Error(`Seed permission ${resourceSlug}/${actionSlug} missing`);
  }
  return permission.id;
}

// Puts user@example.com on the `editor` role with `update:User` (denied on
// the victim), `update:Role` and `assign:Role`.
function delegate(): void {
  const state = getState();
  const rows = [
    { slug: 'act-update', resource: 'res-users', conditions: null },
    { slug: 'act-update', resource: 'res-roles', conditions: null },
    { slug: 'act-assign', resource: 'res-roles', conditions: null }
  ];
  state.rolePermissions = [
    ...state.rolePermissions.filter((rp) => rp.roleId !== EDITOR_ROLE_ID),
    ...rows.map((row, index) => ({
      id: `rp-refusal-${index}`,
      roleId: EDITOR_ROLE_ID,
      permissionId: permissionId(row.slug, row.resource),
      conditions: row.conditions
    })),
    {
      id: 'rp-refusal-deny',
      roleId: mockId('role-moderator'),
      permissionId: permissionId('act-update', 'res-users'),
      conditions: {
        effect: 'deny',
        fieldMatch: { email: ['admin@example.com'] }
      }
    }
  ];
  findUserByEmail('user@example.com')!.roles = ['editor', 'moderator'];
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

async function call(
  method: string,
  path: string,
  body?: object,
  email = 'user@example.com'
): Promise<{ status: number; errorKey?: string }> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await login(email)}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await res.json()) as { errorKey?: string };
  return { status: res.status, errorKey: json.errorKey };
}

function lastRow() {
  const row = getState().auditLogs.at(-1);
  expect(row?.ipAddress).toEqual(expect.any(String));
  return row;
}

describe('audit row of an authorization refusal parity', () => {
  it('writes the route guard refusal', async () => {
    const victim = findUserByEmail('admin@example.com')!;

    expect((await call('DELETE', `/users/${victim.id}`)).status).toBe(403);
    expect(lastRow()).toMatchObject({
      action: 'PERMISSION_CHECK_FAILURE',
      details: { required: ['delete:User'] }
    });
  });

  it('writes the instance check refusal', async () => {
    const victim = findUserByEmail('admin@example.com')!;

    const res = await call('PATCH', `/users/${victim.id}`, {
      firstName: 'Changed'
    });
    expect(res.errorKey).toBe(ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS);
    expect(lastRow()).toMatchObject({
      action: 'PERMISSION_CHECK_FAILURE',
      targetId: victim.id,
      details: { instanceCheck: true }
    });
  });

  it('writes the super-role assignment refusal', async () => {
    const target = findUserByEmail('user@example.com')!;

    const res = await call('POST', `/roles/assign/${target.id}`, {
      roleId: mockId('role-admin')
    });
    expect(res.errorKey).toBe(ErrorKeys.ROLES.SUPER_ROLE_ASSIGN_FORBIDDEN);
    expect(lastRow()).toMatchObject({
      action: 'PERMISSION_CHECK_FAILURE',
      targetId: mockId('role-admin'),
      details: { superRole: true }
    });
  });

  it('answers a system role change by privilege with 403 and writes it', async () => {
    const res = await call('PUT', `/roles/${mockId('role-user')}/permissions`, {
      items: []
    });
    expect(res).toEqual({
      status: 403,
      errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
    });
    expect(lastRow()).toMatchObject({
      action: 'PERMISSION_CHECK_FAILURE',
      targetId: mockId('role-user'),
      details: { systemRole: true }
    });
  });

  it('writes the grant refusal', async () => {
    const res = await call(
      'PUT',
      `/roles/${mockId('role-moderator')}/permissions`,
      { items: [{ permissionId: permissionId('act-delete', 'res-users') }] }
    );
    expect(res.errorKey).toBe(ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION);
    expect(lastRow()).toMatchObject({
      action: 'PERMISSION_GRANT_DENIED',
      targetId: mockId('role-moderator')
    });
  });

  it('writes the two-factor enrolment refusal', async () => {
    process.env['MFA_REQUIRED_FOR_ADMINS'] = 'true';

    const res = await call('GET', '/roles', undefined, 'admin@example.com');
    expect(res.errorKey).toBe(ErrorKeys.AUTH.MFA_ENROLMENT_REQUIRED);
    expect(lastRow()).toMatchObject({
      action: 'PERMISSION_CHECK_FAILURE',
      actorId: findUserByEmail('admin@example.com')!.id,
      details: { required: ['read:Role'], mfaEnrolmentRequired: true }
    });
  });
});
