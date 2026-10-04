import type { Server } from 'http';
import type { PermissionCondition } from '@app/shared/types';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors the server for a grant with a condition: a list keeps only the
// records that the condition allows (applyAbilityToQuery), and a route on one
// record checks that record (assertCan).

let server: Server;
let baseUrl: string;

const SCOPED_ROLE_ID = '5f0c1a4e-7d0b-4c43-9f3e-000000000011';
const OTHER_ROLE_ID = '5f0c1a4e-7d0b-4c43-9f3e-000000000012';
const CALLER_EMAIL = 'user@example.com';
const NEW_DASHBOARD_ID = mockId('flag-new-dashboard');
const BETA_EXPORT_ID = mockId('flag-beta-export');

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

type Grant = [string, string, PermissionCondition | null];

function grant(grants: Grant[]): void {
  const state = getState();
  const now = '2025-01-01T00:00:00.000Z';
  for (const [id, name] of [
    [SCOPED_ROLE_ID, 'scoped'],
    [OTHER_ROLE_ID, 'other']
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
  grants.forEach(([resource, action, conditions], i) => {
    state.rolePermissions.push({
      id: `rp-scoped-${i}`,
      roleId: SCOPED_ROLE_ID,
      permissionId: permissionId(resource, action),
      conditions
    });
  });
  for (const user of state.users.values()) {
    if (user.email === CALLER_EMAIL) user.roles = ['user', 'scoped'];
  }
}

beforeEach(() => {
  resetState();
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
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await login()}`,
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function userEmails(): Promise<string[]> {
  const res = await call('GET', '/users/cursor?limit=100');
  expect(res.status).toBe(200);
  return (res.json as { data: { email: string }[] }).data
    .map((u) => u.email)
    .sort();
}

async function flagKeys(): Promise<string[]> {
  const res = await call('GET', '/admin/feature-flags/cursor?limit=100');
  expect(res.status).toBe(200);
  return (res.json as { data: { key: string }[] }).data
    .map((f) => f.key)
    .sort();
}

describe('conditional search:User on the user list', () => {
  it('lists only the users that match an allow condition', async () => {
    grant([
      [
        'users',
        'search',
        { fieldMatch: { email: ['john@example.com', 'jane@example.com'] } }
      ]
    ]);
    expect(await userEmails()).toEqual([
      'jane@example.com',
      'john@example.com'
    ]);
  });

  it('subtracts the users that match a deny condition', async () => {
    grant([
      [
        'users',
        'search',
        { fieldMatch: { email: ['john@example.com', 'jane@example.com'] } }
      ],
      [
        'users',
        'search',
        { effect: 'deny', fieldMatch: { email: ['jane@example.com'] } }
      ]
    ]);
    expect(await userEmails()).toEqual(['john@example.com']);
  });

  it('lists no user for an allow on a field the server cannot translate', async () => {
    grant([['users', 'search', { fieldMatch: { locale: ['en'] } }]]);
    expect(await userEmails()).toEqual([]);
  });

  it('lists no user for a deny on a field the server cannot translate', async () => {
    grant([
      ['users', 'search', null],
      ['users', 'search', { effect: 'deny', fieldMatch: { locale: ['ru'] } }]
    ]);
    expect(await userEmails()).toEqual([]);
  });
});

describe('conditional grants on FeatureFlag', () => {
  const onlyNewDashboard: PermissionCondition = {
    fieldMatch: { key: ['new-dashboard'] }
  };

  it('filters the flag list', async () => {
    grant([['feature-flags', 'search', onlyNewDashboard]]);
    expect(await flagKeys()).toEqual(['new-dashboard']);
  });

  it('refuses read, preview, update and delete outside the condition', async () => {
    grant([
      ['feature-flags', 'read', onlyNewDashboard],
      ['feature-flags', 'update', onlyNewDashboard],
      ['feature-flags', 'delete', onlyNewDashboard]
    ]);
    const outside = `/admin/feature-flags/${BETA_EXPORT_ID}`;
    expect((await call('GET', outside)).status).toBe(403);
    expect((await call('POST', `${outside}/preview`, {})).status).toBe(403);
    expect(
      (await call('PATCH', outside, { enabled: false }, { 'if-match': '1' }))
        .status
    ).toBe(403);
    expect((await call('DELETE', outside)).status).toBe(403);
    expect(getState().featureFlags.get(BETA_EXPORT_ID)?.enabled).toBe(true);

    const inside = `/admin/feature-flags/${NEW_DASHBOARD_ID}`;
    expect((await call('GET', inside)).status).toBe(200);
  });

  it('refuses a create outside the condition', async () => {
    grant([['feature-flags', 'create', onlyNewDashboard]]);
    const res = await call('POST', '/admin/feature-flags', {
      key: 'another-flag'
    });
    expect(res.status).toBe(403);
  });

  it('refuses a write that moves the flag out of the condition', async () => {
    grant([['feature-flags', 'update', { fieldMatch: { enabled: [false] } }]]);
    const path = `/admin/feature-flags/${NEW_DASHBOARD_ID}`;
    expect(
      (await call('PATCH', path, { enabled: true }, { 'if-match': '1' })).status
    ).toBe(403);
    expect(
      (await call('PATCH', path, { description: 'x' }, { 'if-match': '1' }))
        .status
    ).toBe(200);
  });
});

describe('conditional assign:Role', () => {
  const johnId = (): string =>
    [...getState().users.values()].find((u) => u.email === 'john@example.com')!
      .id;

  beforeEach(() => {
    grant([
      ['users', 'update', null],
      ['roles', 'assign', { fieldMatch: { name: ['scoped'] } }]
    ]);
  });

  it('refuses to assign or remove a role outside the condition', async () => {
    expect(
      (
        await call('POST', `/roles/assign/${johnId()}`, {
          roleId: OTHER_ROLE_ID
        })
      ).status
    ).toBe(403);
    getState().users.get(johnId())!.roles.push('other');
    expect(
      (await call('DELETE', `/roles/assign/${johnId()}/${OTHER_ROLE_ID}`))
        .status
    ).toBe(403);
  });

  it('assigns a role inside the condition', async () => {
    const res = await call('POST', `/roles/assign/${johnId()}`, {
      roleId: SCOPED_ROLE_ID
    });
    expect(res.status).toBe(201);
  });
});
