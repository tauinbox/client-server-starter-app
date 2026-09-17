import type { Server } from 'http';
import { subject } from '@casl/ability';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import {
  buildAbilityForUser,
  getResolvedPermissionsForUser,
  getState,
  resetState
} from '../state';
import { mockId } from '../utils/mock-id';
import type { MockUser } from '../types';
import type { UserEffectivePermissionsResponse } from '@app/shared/types';

let server: Server;
let baseUrl: string;

const REGULAR_ID = mockId('user-2');
const ROLE_IDS = [
  mockId('role-editor'),
  mockId('role-moderator'),
  mockId('role-support')
];

const DENY_A = { effect: 'deny' as const, custom: '{"email":"a@victim.test"}' };
const DENY_B = { effect: 'deny' as const, custom: '{"email":"b@victim.test"}' };

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

function updateUserPermissionId(): string {
  const permission = [...getState().permissions.values()].find(
    (p) =>
      p.resourceId === mockId('res-users') &&
      p.actionId === mockId('act-update')
  );
  if (!permission) throw new Error('Seed permission users/update is missing');
  return permission.id;
}

/**
 * Gives the seeded regular account one allow role and two restriction roles on
 * the same permission, which is the shape the server resolver used to collapse.
 */
function grantAllowAndTwoDenies(): MockUser {
  const state = getState();
  const permissionId = updateUserPermissionId();
  const [allowRoleId, denyRoleA, denyRoleB] = ROLE_IDS;
  state.rolePermissions = [
    ...state.rolePermissions.filter((rp) => !ROLE_IDS.includes(rp.roleId)),
    { id: 'rp-allow', roleId: allowRoleId, permissionId, conditions: null },
    { id: 'rp-deny-a', roleId: denyRoleA, permissionId, conditions: DENY_A },
    { id: 'rp-deny-b', roleId: denyRoleB, permissionId, conditions: DENY_B }
  ];

  const user = state.users.get(REGULAR_ID);
  if (!user) throw new Error('Seed user user@example.com is missing');
  user.roles = ['editor', 'moderator', 'support'];
  return user;
}

// Parity with PermissionService.getPermissionsForUser: rows dedup only when the
// conditions are equal, so two deny roles on one permission both apply.
describe('permission dedup keeps rows with different conditions', () => {
  it('resolves both deny rows', () => {
    const user = grantAllowAndTwoDenies();

    const conditions = getResolvedPermissionsForUser(user).map(
      (p) => p.conditions
    );

    expect(conditions).toEqual([null, DENY_A, DENY_B]);
  });

  it('applies both denies in the compiled ability', () => {
    const user = grantAllowAndTwoDenies();
    const ability = buildAbilityForUser(user);

    for (const email of ['a@victim.test', 'b@victim.test']) {
      expect(ability.can('update', subject('User', { email }))).toBe(false);
    }
    expect(
      ability.can('update', subject('User', { email: 'c@victim.test' }))
    ).toBe(true);
  });

  it('still collapses rows whose conditions are equal', () => {
    const user = grantAllowAndTwoDenies();
    const state = getState();
    const denyB = state.rolePermissions.find((rp) => rp.id === 'rp-deny-b');
    if (!denyB) throw new Error('Test grant rp-deny-b is missing');
    denyB.conditions = { ...DENY_A };

    const conditions = getResolvedPermissionsForUser(user).map(
      (p) => p.conditions
    );

    expect(conditions).toEqual([null, DENY_A]);
  });

  it('returns both deny rows from GET /users/:id/permissions', async () => {
    grantAllowAndTwoDenies();
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password1'
      })
    });
    expect(login.status).toBe(200);
    const { tokens } = (await login.json()) as {
      tokens: { access_token: string };
    };

    const res = await fetch(
      `${baseUrl}/api/v1/users/${REGULAR_ID}/permissions`,
      { headers: { authorization: `Bearer ${tokens.access_token}` } }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as UserEffectivePermissionsResponse;
    const updates = body.permissions.filter(
      (p) => p.permission === 'users:update'
    );
    expect(updates.map((p) => p.conditions)).toEqual([null, DENY_A, DENY_B]);
  });
});
