import type { Server } from 'http';
import type { PermissionCondition } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors the deny part of RoleService's grant scope: only a caller holding a
// pair without restriction can remove a deny row, and a caller under a deny
// cannot hand out an allow on that pair.

let server: Server;
let baseUrl: string;

const DELEGATED_ROLE_ID = '5f0c1a4e-7d0b-4c43-9f3e-000000000001';
const RESTRICT_ROLE_ID = '5f0c1a4e-7d0b-4c43-9f3e-000000000002';
const RESTRICTED_EMAIL = 'user@example.com';
const UNRESTRICTED_EMAIL = 'john@example.com';
const DENY_CEO: PermissionCondition = {
  effect: 'deny',
  fieldMatch: { email: ['admin@example.com'] }
};

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

function permissionId(resource: string, action: string): string {
  const permission = [...getState().permissions.values()].find(
    (p) =>
      p.resourceId === mockId(`res-${resource}`) &&
      p.actionId === mockId(`act-${action}`)
  );
  if (!permission) throw new Error(`Seed permission ${resource}/${action}`);
  return permission.id;
}

const updateUserId = (): string => permissionId('users', 'update');

beforeEach(() => {
  resetState();
  const state = getState();
  const now = '2025-01-01T00:00:00.000Z';
  for (const [id, name] of [
    [DELEGATED_ROLE_ID, 'delegated'],
    [RESTRICT_ROLE_ID, 'restrict']
  ]) {
    state.roles.set(id, {
      id,
      name,
      description: null,
      isSystem: false,
      isSuper: false,
      createdAt: now,
      updatedAt: now
    });
  }
  const grants: [string, string][] = [
    ['users', 'update'],
    ['roles', 'update'],
    ['roles', 'assign'],
    ['roles', 'delete']
  ];
  for (const [resource, action] of grants) {
    state.rolePermissions.push({
      id: `rp-delegated-${resource}-${action}`,
      roleId: DELEGATED_ROLE_ID,
      permissionId: permissionId(resource, action),
      conditions: null
    });
  }
  state.rolePermissions.push({
    id: 'rp-restrict',
    roleId: RESTRICT_ROLE_ID,
    permissionId: updateUserId(),
    conditions: DENY_CEO
  });
  for (const user of state.users.values()) {
    if (user.email === RESTRICTED_EMAIL) {
      user.roles = ['user', 'delegated', 'restrict'];
    }
    if (user.email === UNRESTRICTED_EMAIL) {
      user.roles = ['user', 'delegated'];
    }
  }
});

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; errorKey?: string }> {
  const res = await fetch(`${baseUrl}/api/v1/roles${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as { errorKey?: string }) : {};
  return { status: res.status, errorKey: parsed.errorKey };
}

const userId = (email: string): string => {
  const user = [...getState().users.values()].find((u) => u.email === email);
  if (!user) throw new Error(`Seed user ${email}`);
  return user.id;
};

const liftRefused = { status: 403, errorKey: 'errors.roles.cannotLiftDeny' };
const grantRefused = {
  status: 403,
  errorKey: 'errors.roles.cannotGrantPermission'
};

const restrictRowCount = (): number =>
  getState().rolePermissions.filter((rp) => rp.roleId === RESTRICT_ROLE_ID)
    .length;

describe('deny lift parity with server', () => {
  describe('a caller under the deny', () => {
    it('cannot remove their own restriction role', async () => {
      const token = await login(RESTRICTED_EMAIL);
      const self = userId(RESTRICTED_EMAIL);

      expect(
        await call(token, 'DELETE', `/assign/${self}/${RESTRICT_ROLE_ID}`)
      ).toEqual(liftRefused);
      expect(getState().users.get(self)?.roles).toContain('restrict');
      const audit = getState().auditLogs.filter(
        (row) => row.action === 'PERMISSION_GRANT_DENIED'
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: self,
        targetId: RESTRICT_ROLE_ID,
        targetType: 'Role',
        details: {
          action: 'update',
          subject: 'User',
          permissionId: updateUserId(),
          reason: 'deny-lift'
        }
      });
    });

    it('cannot remove or omit the deny row', async () => {
      const token = await login(RESTRICTED_EMAIL);

      expect(
        await call(
          token,
          'DELETE',
          `/${RESTRICT_ROLE_ID}/permissions/${updateUserId()}`
        )
      ).toEqual(liftRefused);
      expect(
        await call(token, 'PUT', `/${RESTRICT_ROLE_ID}/permissions`, {
          items: []
        })
      ).toEqual(liftRefused);
      expect(
        await call(token, 'PUT', `/${RESTRICT_ROLE_ID}/permissions`, {
          items: [
            {
              permissionId: updateUserId(),
              conditions: {
                effect: 'deny',
                fieldMatch: { email: ['someone-else@example.com'] }
              }
            }
          ]
        })
      ).toEqual(liftRefused);
      expect(restrictRowCount()).toBe(1);
    });

    it('keeps a deny row that a replace sends back unchanged', async () => {
      const token = await login(RESTRICTED_EMAIL);

      const res = await call(token, 'PUT', `/${RESTRICT_ROLE_ID}/permissions`, {
        items: [
          {
            permissionId: updateUserId(),
            // Key order differs from the stored row on purpose.
            conditions: { fieldMatch: DENY_CEO.fieldMatch, effect: 'deny' }
          }
        ]
      });

      expect(res.status).toBe(200);
      expect(restrictRowCount()).toBe(1);
    });

    it('cannot delete the restriction role', async () => {
      const token = await login(RESTRICTED_EMAIL);

      expect(await call(token, 'DELETE', `/${RESTRICT_ROLE_ID}`)).toEqual(
        liftRefused
      );
      expect(getState().roles.has(RESTRICT_ROLE_ID)).toBe(true);
    });

    it('cannot hand out an allow on the restricted pair', async () => {
      const token = await login(RESTRICTED_EMAIL);
      const editor = mockId('role-editor');

      expect(
        await call(token, 'POST', `/${editor}/permissions`, {
          permissionIds: [updateUserId()]
        })
      ).toEqual(grantRefused);
      expect(
        await call(token, 'PUT', `/${editor}/permissions`, {
          items: [{ permissionId: updateUserId() }]
        })
      ).toEqual(grantRefused);
      expect(
        await call(token, 'POST', `/assign/${mockId('user-4')}`, {
          roleId: DELEGATED_ROLE_ID
        })
      ).toEqual(grantRefused);
      expect(getState().users.get(mockId('user-4'))?.roles).not.toContain(
        'delegated'
      );
    });

    it('can still hand out a deny on the restricted pair', async () => {
      const token = await login(RESTRICTED_EMAIL);

      const res = await call(
        token,
        'POST',
        `/${mockId('role-editor')}/permissions`,
        { permissionIds: [updateUserId()], conditions: DENY_CEO }
      );

      expect(res.status).toBe(200);
    });
  });

  it('an unrestricted caller lifts the restriction on every path', async () => {
    const token = await login(UNRESTRICTED_EMAIL);
    const restricted = userId(RESTRICTED_EMAIL);

    expect(
      (await call(token, 'DELETE', `/assign/${restricted}/${RESTRICT_ROLE_ID}`))
        .status
    ).toBe(200);
    expect(
      (
        await call(
          token,
          'DELETE',
          `/${RESTRICT_ROLE_ID}/permissions/${updateUserId()}`
        )
      ).status
    ).toBe(200);
    expect(restrictRowCount()).toBe(0);

    getState().rolePermissions.push({
      id: 'rp-restrict-again',
      roleId: RESTRICT_ROLE_ID,
      permissionId: updateUserId(),
      conditions: DENY_CEO
    });
    expect(
      (
        await call(token, 'PUT', `/${RESTRICT_ROLE_ID}/permissions`, {
          items: []
        })
      ).status
    ).toBe(200);

    getState().rolePermissions.push({
      id: 'rp-restrict-third',
      roleId: RESTRICT_ROLE_ID,
      permissionId: updateUserId(),
      conditions: DENY_CEO
    });
    expect((await call(token, 'DELETE', `/${RESTRICT_ROLE_ID}`)).status).toBe(
      200
    );
    expect(
      getState().auditLogs.filter(
        (row) => row.action === 'PERMISSION_GRANT_DENIED'
      )
    ).toEqual([]);
  });
});
