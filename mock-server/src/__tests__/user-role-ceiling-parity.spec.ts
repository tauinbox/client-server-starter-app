import type { Server } from 'http';
import { randomUUID } from 'crypto';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import {
  buildAbilityForUser,
  findUserById,
  getState,
  resetState
} from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors server/test/user-role-ceiling.e2e-spec.ts: a grant of the universal
// role outside its ceiling never reaches the ability, and the role routes
// refuse to write one.

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

const USER_ROLE_ID = mockId('role-user');

function permissionId(resourceName: string, actionName: string): string {
  const state = getState();
  const resource = state.resources
    .values()
    .find((r) => r.name === resourceName);
  const action = state.actions.values().find((a) => a.name === actionName);
  const permission = state.permissions
    .values()
    .find((p) => p.resourceId === resource?.id && p.actionId === action?.id);

  if (!permission) {
    throw new Error(`Permission ${actionName}:${resourceName} missing`);
  }

  return permission.id;
}

function plainUser() {
  const user = findUserById(mockId('user-2'));

  if (!user) throw new Error('Seed user missing');

  return user;
}

async function adminToken(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  const body = (await res.json()) as { tokens: { access_token: string } };

  return body.tokens.access_token;
}

async function send(method: 'POST' | 'PUT', body: unknown) {
  const res = await fetch(
    `${baseUrl}/api/v1/roles/${USER_ROLE_ID}/permissions`,
    {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await adminToken()}`
      },
      body: JSON.stringify(body)
    }
  );
  const text = await res.text();

  return {
    status: res.status,
    errorKey: text ? (JSON.parse(text) as { errorKey?: string }).errorKey : ''
  };
}

const storedGrants = () =>
  getState().rolePermissions.filter((rp) => rp.roleId === USER_ROLE_ID);

describe('The permission ceiling of the user role (mock parity)', () => {
  it('keeps a stored grant outside the ceiling out of the ability', () => {
    const user = plainUser();

    expect(user.roles).toEqual(['user']);

    getState().rolePermissions.push({
      id: randomUUID(),
      roleId: USER_ROLE_ID,
      permissionId: permissionId('users', 'search'),
      conditions: null
    });

    const ability = buildAbilityForUser(user);

    expect(ability.can('search', 'User')).toBe(false);
    expect(ability.can('update', 'Profile')).toBe(true);
  });

  it('refuses a replace that adds a grant outside the ceiling', async () => {
    const before = storedGrants();

    expect(
      await send('PUT', {
        items: [
          ...before.map(({ permissionId: id, conditions }) => ({
            permissionId: id,
            ...(conditions ? { conditions } : {})
          })),
          { permissionId: permissionId('users', 'search') }
        ]
      })
    ).toEqual({
      status: 422,
      errorKey: ErrorKeys.ROLES.GRANT_OUTSIDE_USER_ROLE
    });
    expect(storedGrants()).toEqual(before);
  });

  it('refuses an add of a grant outside the ceiling', async () => {
    const before = storedGrants();

    expect(
      await send('POST', {
        permissionIds: [permissionId('users', 'search')]
      })
    ).toEqual({
      status: 422,
      errorKey: ErrorKeys.ROLES.GRANT_OUTSIDE_USER_ROLE
    });
    expect(storedGrants()).toEqual(before);
  });

  it('accepts a replace with the grants the role holds', async () => {
    const before = storedGrants();

    expect(
      await send('PUT', {
        items: before.map(({ permissionId: id, conditions }) => ({
          permissionId: id,
          ...(conditions ? { conditions } : {})
        }))
      })
    ).toEqual({ status: 200, errorKey: '' });
  });
});
