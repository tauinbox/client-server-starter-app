import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';
import type { MockRolePermission } from '../types';

let server: Server;
let baseUrl: string;

const ADMIN_ID = mockId('user-1');
const REGULAR_ID = mockId('user-2');
const EDITOR_ROLE_ID = mockId('role-editor');

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
});
