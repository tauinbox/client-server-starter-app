import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../app';
import {
  findUserByEmail,
  getPackedRulesForUser,
  getState,
  resetState
} from '../state';

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

function editorRolePermissions(): unknown[] {
  return getState().rolePermissions.filter((rp) => rp.roleId === 'role-editor');
}

// Mirrors the server's PermissionConditionDto shape validation: a partially
// malformed condition must be rejected with 400, and a stored malformed
// condition must veto the permission during rule packing (fail closed)
// instead of silently widening the grant.
describe('condition shape parity with server', () => {
  describe('PUT /api/v1/roles/:id/permissions', () => {
    async function putConditions(
      conditions: unknown,
      permissionId = 'perm-1'
    ): Promise<Response> {
      const token = await loginAsAdmin();
      return fetch(`${baseUrl}/api/v1/roles/role-editor/permissions`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          items: [{ permissionId, conditions }]
        })
      });
    }

    // perm-1 is create:User, where ownership/userAttr are rejected as
    // unsatisfiable; shape parity for those branches needs another action.
    function updateUserPermissionId(): string {
      const permission = [...getState().permissions.values()].find(
        (p) => p.resourceId === 'res-users' && p.actionId === 'act-update'
      );
      if (!permission)
        throw new Error('Seed permission users/update is missing');
      return permission.id;
    }

    it.each([
      [
        'a partially malformed fieldMatch (forgot array brackets)',
        { fieldMatch: { status: ['active'], dept: 'sales' } },
        'fieldMatch.dept'
      ],
      [
        'an empty fieldMatch array value',
        { fieldMatch: { status: [] } },
        'non-empty array'
      ],
      ['a non-object fieldMatch', { fieldMatch: 5 }, 'fieldMatch'],
      ['an empty ownership object', { ownership: {} }, 'userField'],
      [
        'a non-string userAttr value',
        { userAttr: { ownerId: 123 } },
        'userAttr'
      ],
      [
        'an unknown top-level condition key',
        { unknownBranch: {} },
        'should not exist'
      ],
      [
        'a "$"-prefixed ownership.userField',
        { ownership: { userField: '$or' } },
        '$or'
      ],
      [
        'a "$"-prefixed fieldMatch key',
        { fieldMatch: { status: ['active'], $where: ['x'] } },
        '$where'
      ],
      ['a "$"-prefixed userAttr key', { userAttr: { $expr: 'id' } }, '$expr'],
      ['a non-string custom', { custom: 5 }, 'JSON string']
    ])('rejects %s with 400 and no write', async (_label, conditions, part) => {
      const res = await putConditions(conditions);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string[] };
      expect(body.message.join(' ')).toContain(part);
      expect(editorRolePermissions()).toEqual([]);
    });

    it('accepts a valid condition', async () => {
      const res = await putConditions(
        {
          effect: 'deny',
          ownership: { userField: 'createdBy' },
          fieldMatch: { status: ['active'] },
          userAttr: { ownerId: 'id' },
          custom: '{"status":{"$in":["active"]}}'
        },
        updateUserPermissionId()
      );

      expect(res.status).toBe(200);
      expect(editorRolePermissions()).toHaveLength(1);
    });
  });

  describe('POST /api/v1/roles/:id/permissions', () => {
    it('rejects a malformed conditions object with 400 and no write', async () => {
      const token = await loginAsAdmin();

      const res = await fetch(
        `${baseUrl}/api/v1/roles/role-editor/permissions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            permissionIds: ['perm-1'],
            conditions: { fieldMatch: { status: 'active' } }
          })
        }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string[] };
      expect(body.message.join(' ')).toContain('fieldMatch.status');
      expect(editorRolePermissions()).toEqual([]);
    });
  });

  describe('rule packing (stored-before-fix data)', () => {
    function grantToEditor(conditions: unknown): void {
      getState().rolePermissions.push({
        id: 'rp-shape-test',
        roleId: 'role-editor',
        permissionId: 'perm-1',
        conditions: conditions as null
      });
    }

    function editorUserRules(): { granted: boolean } {
      const user = findUserByEmail('user@example.com');
      if (!user) throw new Error('seed user missing');
      user.roles = ['editor'];

      const state = getState();
      const perm = state.permissions.get('perm-1');
      if (!perm) throw new Error('seed permission missing');
      const resource = state.resources.get(perm.resourceId);
      const action = state.actions.get(perm.actionId);
      if (!resource || !action) throw new Error('seed rbac data missing');

      const rules = getPackedRulesForUser(user);
      const granted = rules.some(
        (rule) =>
          String(rule[0]).includes(action.name) &&
          String(rule[1]).includes(resource.subject)
      );
      return { granted };
    }

    it('vetoes a permission whose stored condition is partially malformed', () => {
      grantToEditor({ fieldMatch: { status: ['active'], dept: 'sales' } });

      expect(editorUserRules().granted).toBe(false);
    });

    it('vetoes a permission whose custom key collides with ownership.userField', () => {
      grantToEditor({
        ownership: { userField: 'ownerId' },
        custom: '{"ownerId":{"$ne":null}}'
      });

      expect(editorUserRules().granted).toBe(false);
    });

    it('vetoes a permission whose fieldMatch key collides with ownership.userField', () => {
      grantToEditor({
        ownership: { userField: 'ownerId' },
        fieldMatch: { ownerId: ['a', 'b'] }
      });

      expect(editorUserRules().granted).toBe(false);
    });

    it('vetoes a permission whose stored condition has a "$"-prefixed key', () => {
      grantToEditor({ ownership: { userField: '$or' } });

      expect(editorUserRules().granted).toBe(false);
    });

    it('vetoes a permission whose stored custom uses an operator outside the allowed set', () => {
      grantToEditor({ custom: '{"email":{"$regex":"x"}}' });

      expect(editorUserRules().granted).toBe(false);
    });

    it('grants the permission when the stored condition is valid (control)', () => {
      grantToEditor({ fieldMatch: { status: ['active'] } });

      expect(editorUserRules().granted).toBe(true);
    });

    it('grants the permission when the stored custom uses an allowed operator (control)', () => {
      grantToEditor({ custom: '{"status":{"$in":["active"]}}' });

      expect(editorUserRules().granted).toBe(true);
    });
  });
});
