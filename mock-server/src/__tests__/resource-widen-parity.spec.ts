import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { buildAbilityForUser, getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors ResourceService: a narrowed or orphaned action keeps its role rows,
// so only a super caller may offer it again.

let server: Server;
let baseUrl: string;

const DELEGATED_ROLE_ID = '5f0c1a4e-7d0b-4c43-9f3e-000000000011';
const ACTOR_EMAIL = 'user@example.com';
const SUPER_EMAIL = 'admin@example.com';
const USERS_RESOURCE_ID = mockId('res-users');

const widenRefused = { status: 403, errorKey: 'errors.resources.cannotWiden' };

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

const usersResource = () => {
  const resource = getState().resources.get(USERS_RESOURCE_ID);
  if (!resource) throw new Error('Seed resource users');
  return resource;
};

const actor = () => {
  const user = [...getState().users.values()].find(
    (u) => u.email === ACTOR_EMAIL
  );
  if (!user) throw new Error(`Seed user ${ACTOR_EMAIL}`);
  return user;
};

const actorCanDelete = (): boolean =>
  buildAbilityForUser(actor()).can('delete', 'User');

beforeEach(() => {
  resetState();
  const state = getState();
  const now = '2025-01-01T00:00:00.000Z';
  state.roles.set(DELEGATED_ROLE_ID, {
    id: DELEGATED_ROLE_ID,
    name: 'delegated',
    description: null,
    isSystem: false,
    isSuper: false,
    createdAt: now,
    updatedAt: now
  });
  for (const [resource, action] of [
    ['permissions', 'update'],
    ['users', 'delete']
  ]) {
    state.rolePermissions.push({
      id: `rp-delegated-${resource}-${action}`,
      roleId: DELEGATED_ROLE_ID,
      permissionId: permissionId(resource, action),
      conditions: null
    });
  }
  actor().roles = ['user', 'delegated'];
  usersResource().allowedActionNames = ['create', 'read', 'update', 'search'];
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
  const res = await fetch(`${baseUrl}/api/v1/rbac/resources/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const parsed = (await res.json()) as { errorKey?: string };
  return { status: res.status, errorKey: parsed.errorKey };
}

describe('resource widen parity with server', () => {
  it('starts with the grant dormant', () => {
    expect(actorCanDelete()).toBe(false);
  });

  it.each([
    ['a larger list', ['create', 'read', 'update', 'delete', 'search']],
    ['null', null]
  ])(
    'refuses a non-super caller widening to %s',
    async (_label, allowedActionNames) => {
      const token = await login(ACTOR_EMAIL);

      expect(
        await call(token, 'PATCH', USERS_RESOURCE_ID, { allowedActionNames })
      ).toEqual(widenRefused);
      expect(actorCanDelete()).toBe(false);
      expect(getState().auditLogs.at(-1)).toMatchObject({
        action: 'PERMISSION_GRANT_DENIED',
        targetId: USERS_RESOURCE_ID,
        targetType: 'Resource'
      });
    }
  );

  it('lets a non-super caller narrow further', async () => {
    const token = await login(ACTOR_EMAIL);

    expect(
      await call(token, 'PATCH', USERS_RESOURCE_ID, {
        allowedActionNames: ['read']
      })
    ).toEqual({ status: 200, errorKey: undefined });
  });

  it('lets a super caller widen', async () => {
    const token = await login(SUPER_EMAIL);

    expect(
      await call(token, 'PATCH', USERS_RESOURCE_ID, {
        allowedActionNames: null
      })
    ).toEqual({ status: 200, errorKey: undefined });
    expect(actorCanDelete()).toBe(true);
  });

  it('refuses a non-super caller restoring an orphaned resource, and lets a super caller', async () => {
    usersResource().allowedActionNames = null;
    usersResource().isOrphaned = true;
    expect(actorCanDelete()).toBe(false);

    const actorToken = await login(ACTOR_EMAIL);
    expect(
      await call(actorToken, 'POST', `${USERS_RESOURCE_ID}/restore`)
    ).toEqual(widenRefused);
    expect(actorCanDelete()).toBe(false);

    const superToken = await login(SUPER_EMAIL);
    expect(
      await call(superToken, 'POST', `${USERS_RESOURCE_ID}/restore`)
    ).toEqual({ status: 200, errorKey: undefined });
    expect(actorCanDelete()).toBe(true);
  });
});
