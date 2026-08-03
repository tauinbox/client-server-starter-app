import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState, getState } from '../state';

let server: Server;
let baseUrl: string;

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

async function loginAsAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Password1'
    })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

// A well-formed id the seed never issues: the server route parses the param as
// a UUID, so an unknown id must be one to reach the not-found path there too.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

function softDeleteUser(id: string): void {
  const user = getState().users.get(id);
  if (!user) throw new Error(`Seed user ${id} is missing`);
  user.deletedAt = new Date().toISOString();
}

function editorPermissionIds(): string[] {
  return getState()
    .rolePermissions.filter((rp) => rp.roleId === 'role-editor')
    .map((rp) => rp.permissionId);
}

// Permission ids are positional in the seed, so resolve them by resource and
// action instead of hardcoding.
function permissionIdFor(resourceId: string, actionId: string): string {
  const permission = [...getState().permissions.values()].find(
    (p) => p.resourceId === resourceId && p.actionId === actionId
  );
  if (!permission) {
    throw new Error(`Seed permission ${resourceId}/${actionId} is missing`);
  }
  return permission.id;
}

describe('role grant error parity with server', () => {
  describe('POST /api/v1/roles/:id/permissions', () => {
    it('returns 400 RESOURCE_NOT_FOUND for an unknown permission id', async () => {
      const token = await loginAsAdmin();

      const res = await fetch(
        `${baseUrl}/api/v1/roles/role-editor/permissions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ permissionIds: ['perm-nope'] })
        }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string; errorKey: string };
      expect(body.message).toBe('Permission perm-nope not found');
      expect(body.errorKey).toBe('errors.general.resourceNotFound');
      expect(editorPermissionIds()).toEqual([]);
    });

    it('returns 409 UNIQUE_VIOLATION on a duplicate pair without partial writes', async () => {
      const token = await loginAsAdmin();
      getState().rolePermissions.push({
        id: 'rp-test',
        roleId: 'role-editor',
        permissionId: 'perm-1',
        conditions: null
      });

      // perm-2 is new, perm-1 already granted: all-or-nothing like the
      // server's single-transaction save.
      const res = await fetch(
        `${baseUrl}/api/v1/roles/role-editor/permissions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ permissionIds: ['perm-2', 'perm-1'] })
        }
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as { message: string; errorKey: string };
      expect(body.message).toBe('A record with this value already exists');
      expect(body.errorKey).toBe('errors.db.uniqueViolation');
      expect(editorPermissionIds()).toEqual(['perm-1']);
    });
  });

  describe('PUT /api/v1/roles/:id/permissions', () => {
    it('returns 400 RESOURCE_NOT_FOUND for an unknown id and leaves the set untouched', async () => {
      const token = await loginAsAdmin();
      getState().rolePermissions.push({
        id: 'rp-test',
        roleId: 'role-editor',
        permissionId: 'perm-1',
        conditions: null
      });

      const res = await fetch(
        `${baseUrl}/api/v1/roles/role-editor/permissions`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            items: [{ permissionId: 'perm-2' }, { permissionId: 'perm-nope' }]
          })
        }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string; errorKey: string };
      expect(body.message).toBe('Permission perm-nope not found');
      expect(body.errorKey).toBe('errors.general.resourceNotFound');
      expect(editorPermissionIds()).toEqual(['perm-1']);
    });
  });

  describe('identity-bound conditions on a create grant', () => {
    it('rejects ownership on a create grant with 400 on POST', async () => {
      const token = await loginAsAdmin();
      const createUser = permissionIdFor('res-users', 'act-create');

      const res = await fetch(
        `${baseUrl}/api/v1/roles/role-editor/permissions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            permissionIds: [createUser],
            conditions: { ownership: { userField: 'createdBy' } }
          })
        }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string; errorKey: string };
      expect(body.message).toContain('Cannot grant create:User');
      expect(body.errorKey).toBe('errors.roles.conditionNotApplicable');
      expect(editorPermissionIds()).toEqual([]);
    });

    it('rejects userAttr on a create grant with 400 on PUT and leaves the set untouched', async () => {
      const token = await loginAsAdmin();
      getState().rolePermissions.push({
        id: 'rp-test',
        roleId: 'role-editor',
        permissionId: 'perm-1',
        conditions: null
      });
      const createUser = permissionIdFor('res-users', 'act-create');

      const res = await fetch(
        `${baseUrl}/api/v1/roles/role-editor/permissions`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            items: [
              {
                permissionId: createUser,
                conditions: { userAttr: { ownerId: 'id' } }
              }
            ]
          })
        }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errorKey: string };
      expect(body.errorKey).toBe('errors.roles.conditionNotApplicable');
      expect(editorPermissionIds()).toEqual(['perm-1']);
    });

    it('accepts ownership on an update grant', async () => {
      const token = await loginAsAdmin();
      const updateUser = permissionIdFor('res-users', 'act-update');

      const res = await fetch(
        `${baseUrl}/api/v1/roles/role-editor/permissions`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            items: [
              {
                permissionId: updateUser,
                conditions: { ownership: { userField: 'id' } }
              }
            ]
          })
        }
      );

      expect(res.status).toBe(200);
      expect(editorPermissionIds()).toEqual([updateUser]);
    });
  });

  describe('POST /api/v1/roles/assign/:userId', () => {
    it('returns 409 on a duplicate assignment with no side effects', async () => {
      const token = await loginAsAdmin();

      // Seed user '2' already holds the 'user' role (role-user).
      const res = await fetch(`${baseUrl}/api/v1/roles/assign/2`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ roleId: 'role-user' })
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { message: string; errorKey: string };
      expect(body.message).toBe('A record with this value already exists');
      expect(body.errorKey).toBe('errors.db.uniqueViolation');

      const user = getState().users.get('2');
      expect(user?.roles).toEqual(['user']);
      expect(user?.tokenRevokedAt).toBeNull();
      expect(
        getState().auditLogs.filter((log) => log.action === 'ROLE_ASSIGN')
      ).toHaveLength(0);
    });

    it('still assigns a new role with the usual side effects', async () => {
      const token = await loginAsAdmin();

      const res = await fetch(`${baseUrl}/api/v1/roles/assign/2`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ roleId: 'role-editor' })
      });

      expect(res.status).toBe(200);
      const user = getState().users.get('2');
      expect(user?.roles).toEqual(['user', 'editor']);
      expect(user?.tokenRevokedAt).not.toBeNull();
      expect(
        getState().auditLogs.filter((log) => log.action === 'ROLE_ASSIGN')
      ).toHaveLength(1);
    });

    it('returns 404 USERS.NOT_FOUND for an unknown user id', async () => {
      const token = await loginAsAdmin();

      const res = await fetch(`${baseUrl}/api/v1/roles/assign/${UNKNOWN_ID}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ roleId: 'role-editor' })
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { errorKey: string };
      expect(body.errorKey).toBe('errors.users.notFound');
    });

    it('returns 404 USERS.NOT_FOUND for a soft-deleted user without changing roles', async () => {
      const token = await loginAsAdmin();
      softDeleteUser('2');

      const res = await fetch(`${baseUrl}/api/v1/roles/assign/2`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ roleId: 'role-editor' })
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { errorKey: string };
      expect(body.errorKey).toBe('errors.users.notFound');
      expect(getState().users.get('2')?.roles).toEqual(['user']);
    });
  });

  describe('DELETE /api/v1/roles/assign/:userId/:roleId', () => {
    it('returns 404 USERS.NOT_FOUND for an unknown user id', async () => {
      const token = await loginAsAdmin();

      const res = await fetch(
        `${baseUrl}/api/v1/roles/assign/${UNKNOWN_ID}/role-user`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` }
        }
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as { errorKey: string };
      expect(body.errorKey).toBe('errors.users.notFound');
    });

    it('returns 404 USERS.NOT_FOUND for a soft-deleted user without changing roles', async () => {
      const token = await loginAsAdmin();
      softDeleteUser('2');

      const res = await fetch(`${baseUrl}/api/v1/roles/assign/2/role-user`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { errorKey: string };
      expect(body.errorKey).toBe('errors.users.notFound');
      expect(getState().users.get('2')?.roles).toEqual(['user']);
    });
  });
});
