import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import {
  findUserByEmail,
  getPackedRulesForUser,
  getState,
  resetState
} from '../state';
import { mockId } from '../utils/mock-id';

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

function editorRolePermissions(): unknown[] {
  return getState().rolePermissions.filter(
    (rp) => rp.roleId === mockId('role-editor')
  );
}

// Mirrors the server's PermissionConditionDto shape validation: a partially
// malformed condition must be rejected with 422, and a stored malformed
// condition must veto the permission during rule packing (fail closed)
// instead of silently widening the grant.
describe('condition shape parity with server', () => {
  describe('PUT /api/v1/roles/:id/permissions', () => {
    async function putConditions(
      conditions: unknown,
      permissionId = mockId('perm-1')
    ): Promise<Response> {
      const token = await loginAsAdmin();
      return fetch(
        `${baseUrl}/api/v1/roles/${mockId('role-editor')}/permissions`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            items: [{ permissionId, conditions }]
          })
        }
      );
    }

    // perm-1 is create:User, where ownership/userAttr are rejected as
    // unsatisfiable; shape parity for those branches needs another action.
    function updateUserPermissionId(): string {
      const permission = [...getState().permissions.values()].find(
        (p) =>
          p.resourceId === mockId('res-users') &&
          p.actionId === mockId('act-update')
      );
      if (!permission)
        throw new Error('Seed permission users/update is missing');
      return permission.id;
    }

    it.each([
      [
        'a partially malformed fieldMatch (forgot array brackets)',
        { fieldMatch: { name: ['active'], email: 'sales' } },
        'fieldMatch.email'
      ],
      [
        'an empty fieldMatch array value',
        { fieldMatch: { name: [] } },
        'non-empty array'
      ],
      ['a non-object fieldMatch', { fieldMatch: 5 }, 'fieldMatch'],
      ['an empty ownership object', { ownership: {} }, 'userField'],
      ['a non-string userAttr value', { userAttr: { name: 123 } }, 'userAttr'],
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
        { fieldMatch: { name: ['active'], $where: ['x'] } },
        '$where'
      ],
      ['a "$"-prefixed userAttr key', { userAttr: { $expr: 'id' } }, '$expr'],
      ['a non-string custom', { custom: 5 }, 'JSON string'],
      [
        'a custom $in list holding a non-scalar element',
        { custom: '{"name":{"$in":["active",{"nested":"x"}]}}' },
        'must be an array of'
      ]
    ])('rejects %s with 422 and no write', async (_label, conditions, part) => {
      const res = await putConditions(conditions);

      expect(res.status).toBe(422);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors.join(' ')).toContain(part);
      expect(editorRolePermissions()).toEqual([]);
    });

    it('accepts a valid condition', async () => {
      const res = await putConditions(
        {
          effect: 'deny',
          ownership: { userField: 'email' },
          fieldMatch: { name: ['active'] },
          userAttr: { name: 'id' },
          custom: '{"name":{"$in":["active"]}}'
        },
        updateUserPermissionId()
      );

      expect(res.status).toBe(200);
      expect(editorRolePermissions()).toHaveLength(1);
    });
  });

  describe('POST /api/v1/roles/:id/permissions', () => {
    it('rejects a malformed conditions object with 422 and no write', async () => {
      const token = await loginAsAdmin();

      const res = await fetch(
        `${baseUrl}/api/v1/roles/${mockId('role-editor')}/permissions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            permissionIds: [mockId('perm-1')],
            conditions: { fieldMatch: { name: 'active' } }
          })
        }
      );

      expect(res.status).toBe(422);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors.join(' ')).toContain('fieldMatch.name');
      expect(editorRolePermissions()).toEqual([]);
    });
  });

  describe('rule packing (stored-before-fix data)', () => {
    function grantToEditor(conditions: unknown): void {
      getState().rolePermissions.push({
        id: 'rp-shape-test',
        roleId: mockId('role-editor'),
        permissionId: mockId('perm-1'),
        conditions: conditions as null
      });
    }

    function editorUserRules(): { granted: boolean } {
      const user = findUserByEmail('user@example.com');
      if (!user) throw new Error('seed user missing');
      user.roles = ['editor'];

      const state = getState();
      const perm = state.permissions.get(mockId('perm-1'));
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
      grantToEditor({ fieldMatch: { name: ['active'], email: 'sales' } });

      expect(editorUserRules().granted).toBe(false);
    });

    it('vetoes a permission whose custom key collides with ownership.userField', () => {
      grantToEditor({
        ownership: { userField: 'name' },
        custom: '{"name":{"$ne":null}}'
      });

      expect(editorUserRules().granted).toBe(false);
    });

    it('vetoes a permission whose fieldMatch key collides with ownership.userField', () => {
      grantToEditor({
        ownership: { userField: 'name' },
        fieldMatch: { name: ['a', 'b'] }
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

    it('vetoes a permission whose stored custom $in list holds a non-scalar element', () => {
      grantToEditor({
        custom: '{"name":{"$in":["active",{"nested":"x"}]}}'
      });

      expect(editorUserRules().granted).toBe(false);
    });

    it('grants the permission when the stored condition is valid (control)', () => {
      grantToEditor({ fieldMatch: { name: ['active'] } });

      expect(editorUserRules().granted).toBe(true);
    });

    it('grants the permission when the stored custom uses an allowed operator (control)', () => {
      grantToEditor({ custom: '{"name":{"$in":["active"]}}' });

      expect(editorUserRules().granted).toBe(true);
    });
  });
});
