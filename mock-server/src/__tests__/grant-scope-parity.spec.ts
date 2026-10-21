import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import type { PermissionCondition } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors assertCanGrantPermissions: a caller grants an allow only on a pair it
// holds (a deny passes on any pair), and
// a caller that holds the pair only with a condition grants only a condition
// at least as narrow. The seeded `user` role holds update:User on its own
// record only, so the caller below is such a conditional holder.

let server: Server;
let baseUrl: string;

const GRANTOR_ROLE_ID = '5f0c1a4e-7d0b-4c43-9f3e-000000000021';
const TARGET_ROLE_ID = '5f0c1a4e-7d0b-4c43-9f3e-000000000022';
const CALLER_EMAIL = 'user@example.com';
const OWN_RECORD: PermissionCondition = { ownership: { userField: 'id' } };

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
const deleteUserId = (): string => permissionId('users', 'delete');

beforeEach(() => {
  resetState();
  const state = getState();
  const now = '2025-01-01T00:00:00.000Z';
  for (const [id, name] of [
    [GRANTOR_ROLE_ID, 'grantor'],
    [TARGET_ROLE_ID, 'target']
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
  for (const action of ['update', 'assign']) {
    state.rolePermissions.push({
      id: `rp-grantor-${action}`,
      roleId: GRANTOR_ROLE_ID,
      permissionId: permissionId('roles', action),
      conditions: null
    });
  }
  for (const user of state.users.values()) {
    if (user.email === CALLER_EMAIL) user.roles = ['user', 'grantor'];
  }
});

async function login(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: CALLER_EMAIL, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function call(
  token: string,
  method: string,
  path: string,
  body: unknown
): Promise<{ status: number; errorKey?: string }> {
  const res = await fetch(`${baseUrl}/api/v1/roles${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as { errorKey?: string }) : {};
  return { status: res.status, errorKey: parsed.errorKey };
}

const callerId = (): string => {
  const user = [...getState().users.values()].find(
    (u) => u.email === CALLER_EMAIL
  );
  if (!user) throw new Error(`Seed user ${CALLER_EMAIL}`);
  return user.id;
};

const lastRefusalReason = (): unknown =>
  getState()
    .auditLogs.filter((row) => row.action === 'PERMISSION_GRANT_DENIED')
    .at(-1)?.details?.['reason'];

const targetRowCount = (): number =>
  getState().rolePermissions.filter((rp) => rp.roleId === TARGET_ROLE_ID)
    .length;

describe('grant scope parity with server', () => {
  const cases: {
    name: string;
    permissionId: () => string;
    conditions: PermissionCondition | null;
    errorKey: string;
    reason?: string;
  }[] = [
    {
      name: 'a pair the caller does not hold',
      permissionId: deleteUserId,
      conditions: null,
      errorKey: ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION
    },
    {
      name: 'an unconditional grant of a pair held only with a condition',
      permissionId: updateUserId,
      conditions: null,
      errorKey: ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION,
      reason: 'condition-escalation'
    },
    {
      name: 'a condition broader than the caller own',
      permissionId: updateUserId,
      conditions: { fieldMatch: { isActive: [true] } },
      errorKey: ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER,
      reason: 'condition-broader-than-caller'
    },
    {
      name: 'a condition the resolver vetoes',
      permissionId: updateUserId,
      conditions: { ownership: { userField: 'id' }, custom: '{"id":"x"}' },
      errorKey: ErrorKeys.ROLES.CONDITION_UNRESOLVABLE,
      reason: 'condition-unresolvable'
    }
  ];

  describe.each(cases)('refuses $name', (c) => {
    it('on POST /:id/permissions', async () => {
      const token = await login();

      expect(
        await call(token, 'POST', `/${TARGET_ROLE_ID}/permissions`, {
          permissionIds: [c.permissionId()],
          ...(c.conditions ? { conditions: c.conditions } : {})
        })
      ).toEqual({ status: 403, errorKey: c.errorKey });
      expect(lastRefusalReason()).toBe(c.reason);
      expect(targetRowCount()).toBe(0);
    });

    it('on PUT /:id/permissions', async () => {
      const token = await login();

      expect(
        await call(token, 'PUT', `/${TARGET_ROLE_ID}/permissions`, {
          items: [{ permissionId: c.permissionId(), conditions: c.conditions }]
        })
      ).toEqual({ status: 403, errorKey: c.errorKey });
      expect(targetRowCount()).toBe(0);
    });

    it('on POST /assign/:userId of a role that holds it', async () => {
      getState().rolePermissions.push({
        id: 'rp-target',
        roleId: TARGET_ROLE_ID,
        permissionId: c.permissionId(),
        conditions: c.conditions
      });
      const token = await login();

      expect(
        await call(token, 'POST', `/assign/${callerId()}`, {
          roleId: TARGET_ROLE_ID
        })
      ).toEqual({ status: 403, errorKey: c.errorKey });
      expect(getState().users.get(callerId())?.roles).not.toContain('target');
    });
  });

  it.each([
    ['an equal condition', OWN_RECORD],
    [
      'a stricter condition',
      { ...OWN_RECORD, fieldMatch: { isActive: [true] } }
    ]
  ])('allows %s', async (_name, conditions) => {
    const token = await login();

    const res = await call(token, 'POST', `/${TARGET_ROLE_ID}/permissions`, {
      permissionIds: [updateUserId()],
      conditions
    });

    expect(res.status).toBe(200);
    expect(targetRowCount()).toBe(1);
  });

  describe('allows a deny on a pair the caller does not hold', () => {
    const deny: PermissionCondition = {
      effect: 'deny',
      fieldMatch: { email: ['ceo@example.com'] }
    };

    it('on POST /:id/permissions', async () => {
      const token = await login();

      const res = await call(token, 'POST', `/${TARGET_ROLE_ID}/permissions`, {
        permissionIds: [deleteUserId()],
        conditions: deny
      });

      expect(res.status).toBe(200);
      expect(targetRowCount()).toBe(1);
    });

    it('on PUT /:id/permissions', async () => {
      const token = await login();

      const res = await call(token, 'PUT', `/${TARGET_ROLE_ID}/permissions`, {
        items: [{ permissionId: deleteUserId(), conditions: deny }]
      });

      expect(res.status).toBe(200);
      expect(targetRowCount()).toBe(1);
    });

    it('on POST /assign/:userId of a role that holds it', async () => {
      getState().rolePermissions.push({
        id: 'rp-target',
        roleId: TARGET_ROLE_ID,
        permissionId: deleteUserId(),
        conditions: deny
      });
      const token = await login();

      const res = await call(token, 'POST', `/assign/${callerId()}`, {
        roleId: TARGET_ROLE_ID
      });

      expect(res.status).toBe(201);
      expect(getState().users.get(callerId())?.roles).toContain('target');
    });
  });
});
