import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../app';
import { resetState, getState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll((done) => {
  resetState();
  const app = createApp();
  server = app.listen(0, () => {
    const addr = server.address() as AddressInfo;
    baseUrl = `http://localhost:${addr.port}`;
    done();
  });
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

function editorPermissionIds(): string[] {
  return getState()
    .rolePermissions.filter((rp) => rp.roleId === 'role-editor')
    .map((rp) => rp.permissionId);
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
  });
});
