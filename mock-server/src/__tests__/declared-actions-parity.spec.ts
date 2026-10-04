import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { buildAbilityForUser, getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

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

async function adminToken(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function send(
  method: string,
  path: string,
  body: unknown
): Promise<{ status: number; errorKey?: string }> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await adminToken()}`
    },
    body: JSON.stringify(body)
  });
  const json = (await res.json()) as { errorKey?: string };
  return { status: res.status, errorKey: json.errorKey };
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

const EDITOR_ROLE_ID = mockId('role-editor');

describe('declared action lists parity with server', () => {
  it('refuses to offer an action the resource does not check', async () => {
    const res = await send(
      'PATCH',
      `/rbac/resources/${mockId('res-billing')}`,
      { allowedActionNames: ['search', 'delete'] }
    );

    expect(res).toEqual({
      status: 400,
      errorKey: ErrorKeys.RESOURCES.ACTION_NOT_DECLARED
    });
  });

  it('refuses a condition on an action whose checks never read the record', async () => {
    const res = await send('PUT', `/roles/${EDITOR_ROLE_ID}/permissions`, {
      items: [
        {
          permissionId: permissionId('res-billing', 'act-update'),
          conditions: { fieldMatch: { status: ['active'] } }
        }
      ]
    });

    expect(res).toEqual({
      status: 400,
      errorKey: ErrorKeys.ROLES.CONDITION_NOT_SUPPORTED
    });
  });

  it('refuses an allow on an action the admin stopped offering', async () => {
    getState().resources.get(mockId('res-billing'))!.allowedActionNames = [
      'search'
    ];

    const res = await send('PUT', `/roles/${EDITOR_ROLE_ID}/permissions`, {
      items: [{ permissionId: permissionId('res-billing', 'act-refund') }]
    });

    expect(res).toEqual({
      status: 400,
      errorKey: ErrorKeys.ROLES.ACTION_NOT_GRANTABLE
    });
  });

  it('fails closed on a stored grant the declared lists no longer allow', () => {
    const state = getState();
    state.resources.get(mockId('res-billing'))!.allowedActionNames = ['search'];
    state.rolePermissions = [
      {
        id: 'rp-stored-refund',
        roleId: EDITOR_ROLE_ID,
        permissionId: permissionId('res-billing', 'act-refund'),
        conditions: null
      },
      {
        id: 'rp-stored-conditional',
        roleId: EDITOR_ROLE_ID,
        permissionId: permissionId('res-billing', 'act-search'),
        conditions: { fieldMatch: { status: ['active'] } }
      }
    ];
    const user = state.users.get(mockId('user-2'))!;
    user.roles = ['editor'];

    const ability = buildAbilityForUser(user);

    expect(ability.can('refund', 'Billing')).toBe(false);
    expect(ability.can('search', 'Billing')).toBe(false);
  });
});
