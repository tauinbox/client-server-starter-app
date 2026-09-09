import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';
import type { MockAuditLog, MockRolePermission } from '../types';

let server: Server;
let baseUrl: string;

const ADMIN_ID = mockId('user-1');
const REGULAR_ID = mockId('user-2');
const EDITOR_ROLE_ID = mockId('role-editor');
const MODERATOR_ROLE_ID = mockId('role-moderator');
const SUPPORT_ROLE_ID = mockId('role-support');
const USERS_RESOURCE_ID = mockId('res-users');
const ROLES_RESOURCE_ID = mockId('res-roles');
const READ_ACTION_ID = mockId('act-read');
const UPDATE_ACTION_ID = mockId('act-update');

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

function permissionId(resourceSlug: string, actionSlug: string): string {
  const permission = [...getState().permissions.values()].find(
    (p) =>
      p.resourceId === mockId(resourceSlug) && p.actionId === mockId(actionSlug)
  );
  if (!permission) {
    throw new Error(`Seed permission ${resourceSlug}/${actionSlug} is missing`);
  }
  return permission.id;
}

/**
 * Puts the seeded regular account on the non-super `editor` role and gives that
 * role exactly the listed grants. This is the delegated shape the server admits
 * and the mock could not express while it authorized by role name.
 */
function delegateToRegularUser(
  grants: {
    permissionId: string;
    conditions?: MockRolePermission['conditions'];
  }[]
): void {
  const state = getState();
  state.rolePermissions = [
    ...state.rolePermissions.filter((rp) => rp.roleId !== EDITOR_ROLE_ID),
    ...grants.map((grant, index) => ({
      id: `rp-delegated-${index}`,
      roleId: EDITOR_ROLE_ID,
      permissionId: grant.permissionId,
      conditions: grant.conditions ?? null
    }))
  ];

  const user = state.users.get(REGULAR_ID);
  if (!user) throw new Error('Seed user user@example.com is missing');
  user.roles = ['editor'];
}

async function readMessage(res: Response): Promise<string> {
  const body = (await res.json()) as { message?: string };
  return body.message ?? '';
}

// Parity with PermissionsGuard: every administration route is gated by the CASL
// tuple its server counterpart carries, never by a role name. A route therefore
// refuses an authenticated account that holds no matching grant, and admits a
// delegated non-super role that does.
describe('permission-based route authorization', () => {
  describe('type-level guard', () => {
    it('refuses GET /users/:id for an account without read:User', async () => {
      const token = await login('user@example.com');

      const res = await fetch(`${baseUrl}/api/v1/users/${ADMIN_ID}`, {
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.status).toBe(403);
      expect(await readMessage(res)).toBe('Insufficient permissions');
    });

    it('admits GET /users/:id for the administrator', async () => {
      const token = await login('admin@example.com');

      const res = await fetch(`${baseUrl}/api/v1/users/${ADMIN_ID}`, {
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.status).toBe(200);
    });

    it('answers 401 before 403 when no token is sent', async () => {
      const res = await fetch(`${baseUrl}/api/v1/users/${ADMIN_ID}`);

      expect(res.status).toBe(401);
    });

    it('admits a delegated non-super role on the granted tuple only', async () => {
      delegateToRegularUser([
        { permissionId: permissionId('res-users', 'act-read') }
      ]);
      const token = await login('user@example.com');

      const read = await fetch(`${baseUrl}/api/v1/users/${ADMIN_ID}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(read.status).toBe(200);

      const patch = await fetch(`${baseUrl}/api/v1/users/${ADMIN_ID}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ firstName: 'Renamed' })
      });
      expect(patch.status).toBe(403);
      expect(await readMessage(patch)).toBe('Insufficient permissions');
    });
  });

  // The route guard ignores conditions, so both create routes re-evaluate the
  // ability against the submitted body, matching the controllers' assertCan.
  describe('instance-level check on the create routes', () => {
    it('applies a conditional create:Role grant to POST /roles', async () => {
      delegateToRegularUser([
        {
          permissionId: permissionId('res-roles', 'act-create'),
          conditions: { fieldMatch: { name: ['blessed'] } }
        }
      ]);
      const token = await login('user@example.com');

      async function createRole(name: string): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/roles`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ name })
        });
      }

      const allowed = await createRole('blessed');
      expect(allowed.status).toBe(201);

      const denied = await createRole('unblessed');
      expect(denied.status).toBe(403);
      expect(await readMessage(denied)).toBe('Insufficient permissions');
    });

    it('applies a conditional create:Permission grant to POST /rbac/actions', async () => {
      delegateToRegularUser([
        {
          permissionId: permissionId('res-permissions', 'act-create'),
          conditions: { fieldMatch: { name: ['publish'] } }
        }
      ]);
      const token = await login('user@example.com');

      async function createAction(name: string): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/rbac/actions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ name, displayName: 'Any' })
        });
      }

      const allowed = await createAction('publish');
      expect(allowed.status).toBe(201);

      const denied = await createAction('archive');
      expect(denied.status).toBe(403);
      expect(await readMessage(denied)).toBe('Insufficient permissions');
    });

    it('rejects a body that fails validation before the instance check', async () => {
      delegateToRegularUser([
        {
          permissionId: permissionId('res-roles', 'act-create'),
          conditions: { fieldMatch: { name: ['blessed'] } }
        }
      ]);
      const token = await login('user@example.com');

      const res = await fetch(`${baseUrl}/api/v1/roles`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: '   ' })
      });

      expect(res.status).toBe(400);
    });
  });

  // Every route whose server counterpart calls `assertCan` a second time with
  // the looked-up record. The route guard admits the tuple, and the condition
  // decides the record.
  describe('instance-level check on the record routes', () => {
    const UNBREACHED_PASSWORD = 'Sc3nicRoute!42';

    async function send(
      token: string,
      method: string,
      path: string,
      body?: unknown
    ): Promise<Response> {
      return fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    }

    async function expectRefused(res: Response): Promise<void> {
      expect(res.status).toBe(403);
      expect(await readMessage(res)).toBe('Insufficient permissions');
    }

    async function delegate(
      grants: {
        permissionId: string;
        conditions?: MockRolePermission['conditions'];
      }[]
    ): Promise<string> {
      delegateToRegularUser(grants);
      return login('user@example.com');
    }

    it('applies a conditional read:User grant to the two user read routes', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-users', 'act-read'),
          conditions: { fieldMatch: { id: [REGULAR_ID] } }
        }
      ]);

      expect(
        (await send(token, 'GET', `/api/v1/users/${REGULAR_ID}`)).status
      ).toBe(200);
      await expectRefused(
        await send(token, 'GET', `/api/v1/users/${ADMIN_ID}`)
      );

      expect(
        (await send(token, 'GET', `/api/v1/users/${REGULAR_ID}/permissions`))
          .status
      ).toBe(200);
      await expectRefused(
        await send(token, 'GET', `/api/v1/users/${ADMIN_ID}/permissions`)
      );
    });

    it('applies a conditional create:User grant to POST /users', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-users', 'act-create'),
          conditions: { fieldMatch: { locale: ['ru'] } }
        }
      ]);

      const allowed = await send(token, 'POST', '/api/v1/users', {
        email: 'allowed@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        password: UNBREACHED_PASSWORD,
        locale: 'ru'
      });
      expect(allowed.status).toBe(201);

      await expectRefused(
        await send(token, 'POST', '/api/v1/users', {
          email: 'refused@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          password: UNBREACHED_PASSWORD,
          locale: 'en'
        })
      );
    });

    it('answers 400 on POST /users for a body that fails the DTO, even when the condition refuses', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-users', 'act-create'),
          conditions: { fieldMatch: { locale: ['ru'] } }
        }
      ]);

      const res = await send(token, 'POST', '/api/v1/users', {
        email: 'refused@example.com',
        firstName: 'Ada',
        password: UNBREACHED_PASSWORD,
        locale: 'en'
      });

      expect(res.status).toBe(400);
    });

    it('answers 403 on POST /users above the blocklist, which the server checks below the ability', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-users', 'act-create'),
          conditions: { fieldMatch: { locale: ['ru'] } }
        }
      ]);

      await expectRefused(
        await send(token, 'POST', '/api/v1/users', {
          email: 'refused@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          password: 'Password1',
          locale: 'en'
        })
      );
    });

    it('applies a conditional update:User grant to PATCH /users/:id', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-users', 'act-update'),
          conditions: { fieldMatch: { id: [REGULAR_ID] } }
        }
      ]);

      const allowed = await send(
        token,
        'PATCH',
        `/api/v1/users/${REGULAR_ID}`,
        { firstName: 'Renamed' }
      );
      expect(allowed.status).toBe(200);

      await expectRefused(
        await send(token, 'PATCH', `/api/v1/users/${ADMIN_ID}`, {
          firstName: 'Renamed'
        })
      );
    });

    it('answers 403 on PATCH /users/:id above the blocklist, which the server checks below the ability', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-users', 'act-update'),
          conditions: { fieldMatch: { id: [REGULAR_ID] } }
        }
      ]);

      await expectRefused(
        await send(token, 'PATCH', `/api/v1/users/${ADMIN_ID}`, {
          password: 'Password1'
        })
      );
    });

    it('applies a conditional delete:User grant to DELETE /users/:id and its restore', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-users', 'act-delete'),
          conditions: { fieldMatch: { id: [ADMIN_ID] } }
        }
      ]);

      expect(
        (await send(token, 'DELETE', `/api/v1/users/${ADMIN_ID}`)).status
      ).toBe(200);
      await expectRefused(
        await send(token, 'DELETE', `/api/v1/users/${REGULAR_ID}`)
      );

      expect(
        (await send(token, 'POST', `/api/v1/users/${ADMIN_ID}/restore`)).status
      ).toBe(200);
      await expectRefused(
        await send(token, 'POST', `/api/v1/users/${REGULAR_ID}/restore`)
      );
    });

    it('applies a conditional read:Role grant to the two role read routes', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-roles', 'act-read'),
          conditions: { fieldMatch: { name: ['editor'] } }
        }
      ]);

      expect(
        (await send(token, 'GET', `/api/v1/roles/${EDITOR_ROLE_ID}`)).status
      ).toBe(200);
      await expectRefused(
        await send(token, 'GET', `/api/v1/roles/${MODERATOR_ROLE_ID}`)
      );

      expect(
        (
          await send(
            token,
            'GET',
            `/api/v1/roles/${EDITOR_ROLE_ID}/permissions`
          )
        ).status
      ).toBe(200);
      await expectRefused(
        await send(
          token,
          'GET',
          `/api/v1/roles/${MODERATOR_ROLE_ID}/permissions`
        )
      );
    });

    it('applies a conditional update:Role grant to PATCH /roles/:id', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-roles', 'act-update'),
          conditions: { fieldMatch: { name: ['moderator'] } }
        }
      ]);

      const allowed = await send(
        token,
        'PATCH',
        `/api/v1/roles/${MODERATOR_ROLE_ID}`,
        { description: 'Renamed' }
      );
      expect(allowed.status).toBe(200);

      await expectRefused(
        await send(token, 'PATCH', `/api/v1/roles/${SUPPORT_ROLE_ID}`, {
          description: 'Renamed'
        })
      );
    });

    it('applies a conditional delete:Role grant to DELETE /roles/:id', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-roles', 'act-delete'),
          conditions: { fieldMatch: { name: ['moderator'] } }
        }
      ]);

      expect(
        (await send(token, 'DELETE', `/api/v1/roles/${MODERATOR_ROLE_ID}`))
          .status
      ).toBe(200);
      await expectRefused(
        await send(token, 'DELETE', `/api/v1/roles/${SUPPORT_ROLE_ID}`)
      );
    });

    it('applies a conditional update:Role grant to the three role-permission routes', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-roles', 'act-update'),
          conditions: { fieldMatch: { name: ['moderator'] } }
        }
      ]);
      const granted = permissionId('res-profile', 'act-read');

      expect(
        (
          await send(
            token,
            'PUT',
            `/api/v1/roles/${MODERATOR_ROLE_ID}/permissions`,
            { items: [] }
          )
        ).status
      ).toBe(200);
      await expectRefused(
        await send(
          token,
          'PUT',
          `/api/v1/roles/${SUPPORT_ROLE_ID}/permissions`,
          { items: [] }
        )
      );

      expect(
        (
          await send(
            token,
            'POST',
            `/api/v1/roles/${MODERATOR_ROLE_ID}/permissions`,
            { permissionIds: [granted] }
          )
        ).status
      ).toBe(200);
      await expectRefused(
        await send(
          token,
          'POST',
          `/api/v1/roles/${SUPPORT_ROLE_ID}/permissions`,
          { permissionIds: [granted] }
        )
      );

      expect(
        (
          await send(
            token,
            'DELETE',
            `/api/v1/roles/${MODERATOR_ROLE_ID}/permissions/${granted}`
          )
        ).status
      ).toBe(200);
      await expectRefused(
        await send(
          token,
          'DELETE',
          `/api/v1/roles/${SUPPORT_ROLE_ID}/permissions/${granted}`
        )
      );
    });

    it('applies a conditional update:User grant to the two role-assignment routes', async () => {
      const token = await delegate([
        { permissionId: permissionId('res-roles', 'act-assign') },
        {
          permissionId: permissionId('res-users', 'act-update'),
          conditions: { fieldMatch: { id: [ADMIN_ID] } }
        }
      ]);

      expect(
        (
          await send(token, 'POST', `/api/v1/roles/assign/${ADMIN_ID}`, {
            roleId: SUPPORT_ROLE_ID
          })
        ).status
      ).toBe(200);
      await expectRefused(
        await send(token, 'POST', `/api/v1/roles/assign/${REGULAR_ID}`, {
          roleId: SUPPORT_ROLE_ID
        })
      );

      expect(
        (
          await send(
            token,
            'DELETE',
            `/api/v1/roles/assign/${ADMIN_ID}/${SUPPORT_ROLE_ID}`
          )
        ).status
      ).toBe(200);
      await expectRefused(
        await send(
          token,
          'DELETE',
          `/api/v1/roles/assign/${REGULAR_ID}/${SUPPORT_ROLE_ID}`
        )
      );
    });

    it('applies a conditional update:Permission grant to the two resource routes', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-permissions', 'act-update'),
          conditions: { fieldMatch: { name: ['users'] } }
        }
      ]);

      expect(
        (
          await send(
            token,
            'PATCH',
            `/api/v1/rbac/resources/${USERS_RESOURCE_ID}`,
            { displayName: 'Renamed' }
          )
        ).status
      ).toBe(200);
      await expectRefused(
        await send(
          token,
          'PATCH',
          `/api/v1/rbac/resources/${ROLES_RESOURCE_ID}`,
          { displayName: 'Renamed' }
        )
      );

      expect(
        (
          await send(
            token,
            'POST',
            `/api/v1/rbac/resources/${USERS_RESOURCE_ID}/restore`
          )
        ).status
      ).toBe(200);
      await expectRefused(
        await send(
          token,
          'POST',
          `/api/v1/rbac/resources/${ROLES_RESOURCE_ID}/restore`
        )
      );
    });

    it('applies a conditional update:Permission grant to PATCH /rbac/actions/:id', async () => {
      const token = await delegate([
        {
          permissionId: permissionId('res-permissions', 'act-update'),
          conditions: { fieldMatch: { name: ['read'] } }
        }
      ]);

      const allowed = await send(
        token,
        'PATCH',
        `/api/v1/rbac/actions/${READ_ACTION_ID}`,
        { displayName: 'Renamed' }
      );
      expect(allowed.status).toBe(200);

      await expectRefused(
        await send(token, 'PATCH', `/api/v1/rbac/actions/${UPDATE_ACTION_ID}`, {
          displayName: 'Renamed'
        })
      );
    });

    it('applies a conditional delete:Permission grant to DELETE /rbac/actions/:id', async () => {
      const adminToken = await login('admin@example.com');
      const created: Record<string, string> = {};
      for (const name of ['publish', 'archive']) {
        const res = await send(adminToken, 'POST', '/api/v1/rbac/actions', {
          name,
          displayName: name
        });
        expect(res.status).toBe(201);
        created[name] = ((await res.json()) as { id: string }).id;
      }

      const token = await delegate([
        {
          permissionId: permissionId('res-permissions', 'act-delete'),
          conditions: { fieldMatch: { name: ['publish'] } }
        }
      ]);

      expect(
        (
          await send(
            token,
            'DELETE',
            `/api/v1/rbac/actions/${created['publish']}`
          )
        ).status
      ).toBe(200);
      await expectRefused(
        await send(
          token,
          'DELETE',
          `/api/v1/rbac/actions/${created['archive']}`
        )
      );
    });
  });

  // `manage` is a reserved CASL action name, so no permission row can carry it
  // on either side. The billing and feature-flag administration routes are
  // therefore reachable by a super role only, on the mock as on the server.
  describe('reserved manage tuple', () => {
    it('refuses the feature-flag administration router for a delegated role', async () => {
      delegateToRegularUser([
        { permissionId: permissionId('res-feature-flags', 'act-read') }
      ]);
      const token = await login('user@example.com');

      const res = await fetch(`${baseUrl}/api/v1/admin/feature-flags`, {
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.status).toBe(403);
      expect(await readMessage(res)).toBe('Insufficient permissions');
    });

    it('admits the feature-flag administration router for the administrator', async () => {
      const token = await login('admin@example.com');

      const res = await fetch(`${baseUrl}/api/v1/admin/feature-flags`, {
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.status).toBe(200);
    });

    it('admits the billing administration router for the administrator', async () => {
      const token = await login('admin@example.com');

      const res = await fetch(`${baseUrl}/api/v1/admin/billing/subscriptions`, {
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.status).toBe(200);
    });
  });

  // ResourceSyncService registers six resources on the server and auto-creates
  // a permission for each one against every action, so the seeded catalog of
  // the mock has to carry the same six.
  describe('resource catalog', () => {
    it('seeds every subject the server registers', async () => {
      const token = await login('admin@example.com');

      const res = await fetch(`${baseUrl}/api/v1/rbac/resources`, {
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.status).toBe(200);
      const resources = (await res.json()) as { name: string }[];
      expect(resources.map((r) => r.name).sort()).toEqual([
        'billing',
        'feature-flags',
        'permissions',
        'profile',
        'roles',
        'users'
      ]);
    });

    it('pairs every resource with every action', async () => {
      const token = await login('admin@example.com');

      const res = await fetch(`${baseUrl}/api/v1/roles/permissions`, {
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.status).toBe(200);
      const permissions = (await res.json()) as unknown[];
      expect(permissions).toHaveLength(36);
    });
  });
  // Parity with the two server layers that audit a denial before they throw:
  // PermissionsGuard (permissions.guard.ts) and assertCan (assert-can.util.ts).
  // Neither passes an actorEmail, so both rows hold null there.
  describe('audit trail on a denied authorization', () => {
    function denials(): MockAuditLog[] {
      return getState().auditLogs.filter(
        (row) => row.action === 'PERMISSION_CHECK_FAILURE'
      );
    }

    it('records the required tuple when the type-level guard refuses', async () => {
      const token = await login('user@example.com');

      const res = await fetch(`${baseUrl}/api/v1/users/${ADMIN_ID}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.status).toBe(403);

      const rows = denials();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: REGULAR_ID,
        actorEmail: null,
        targetId: null,
        targetType: null,
        details: { required: ['read:User'] }
      });
      expect(rows[0]?.ipAddress).toBeTruthy();
    });

    it('writes no row when the request carries no token', async () => {
      const res = await fetch(`${baseUrl}/api/v1/users/${ADMIN_ID}`);

      expect(res.status).toBe(401);
      expect(denials()).toHaveLength(0);
    });

    it('records the instance check when a condition refuses a create', async () => {
      delegateToRegularUser([
        {
          permissionId: permissionId('res-roles', 'act-create'),
          conditions: { fieldMatch: { name: ['blessed'] } }
        }
      ]);
      const token = await login('user@example.com');

      const res = await fetch(`${baseUrl}/api/v1/roles`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: 'unblessed' })
      });
      expect(res.status).toBe(403);

      const rows = denials();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: REGULAR_ID,
        actorEmail: null,
        // A create route submits a record that carries no id yet, and the
        // server omits targetId there.
        targetId: null,
        targetType: 'Role',
        ipAddress: null,
        details: {
          instanceCheck: true,
          deniedAction: 'create',
          subject: 'Role'
        }
      });
    });

    // The rbac routes authorize the `Permission` subject while the server
    // audits the entity the record belongs to.
    it('audits an rbac action denial as targetType Action', async () => {
      delegateToRegularUser([
        {
          permissionId: permissionId('res-permissions', 'act-update'),
          conditions: { fieldMatch: { name: ['publish'] } }
        }
      ]);
      const token = await login('user@example.com');

      const res = await fetch(
        `${baseUrl}/api/v1/rbac/actions/${READ_ACTION_ID}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ displayName: 'Renamed' })
        }
      );
      expect(res.status).toBe(403);

      const rows = denials();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: REGULAR_ID,
        targetId: READ_ACTION_ID,
        targetType: 'Action',
        details: {
          instanceCheck: true,
          deniedAction: 'update',
          subject: 'Permission'
        }
      });
    });
  });
});
