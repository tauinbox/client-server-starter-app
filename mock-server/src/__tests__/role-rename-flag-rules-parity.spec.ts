import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';

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
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function roleNamesOf(flagId: string): string[][] {
  return getState()
    .featureFlagRules.filter((r) => r.flagId === flagId)
    .map((r) => (r.payload.type === 'role' ? r.payload.roleNames : []));
}

function versionOf(flagId: string): number {
  const flag = getState().featureFlags.get(flagId);
  if (!flag) throw new Error(`Flag ${flagId} is missing`);
  return flag.version;
}

// Mirrors server/test/role-rename-flag-rules.e2e-spec.ts: flag role rules
// store role names, so a rename or a delete through the roles API rewrites them.
describe('role rename and delete rewrite flag role rules (parity)', () => {
  async function setUp(roleNames: string[][]): Promise<{
    admin: string;
    user: string;
    roleId: string;
    flagId: string;
    key: string;
  }> {
    const admin = await login('admin@example.com');
    const roleRes = await call(admin, 'POST', '/roles', { name: 'beta' });
    expect(roleRes.status).toBe(201);
    const roleId = ((await roleRes.json()) as { id: string }).id;

    const holder = [...getState().users.values()].find(
      (u) => u.email === 'user@example.com'
    );
    if (!holder) throw new Error('Seed user is missing');
    holder.roles.push('beta');
    const user = await login('user@example.com');

    const key = 'beta-feature';
    const flagRes = await call(admin, 'POST', '/admin/feature-flags', {
      key,
      enabled: true
    });
    expect(flagRes.status).toBe(201);
    const flagId = ((await flagRes.json()) as { id: string }).id;
    const rulesRes = await call(
      admin,
      'PUT',
      `/admin/feature-flags/${flagId}/rules`,
      {
        rules: roleNames.map((names) => ({
          type: 'role',
          effect: 'include',
          payload: { type: 'role', roleNames: names }
        }))
      }
    );
    expect(rulesRes.status).toBe(200);
    return { admin, user, roleId, flagId, key };
  }

  async function userSees(user: string, key: string): Promise<boolean> {
    const res = await call(user, 'GET', '/feature-flags');
    const body = (await res.json()) as { flags: Record<string, boolean> };
    return body.flags[key] === true;
  }

  it('keeps the targeting on rename and drops the name on delete', async () => {
    const { admin, user, roleId, flagId, key } = await setUp([
      ['beta', 'staff'],
      ['beta-2', 'beta']
    ]);
    const versionBefore = versionOf(flagId);
    expect(await userSees(user, key)).toBe(true);

    const renameRes = await call(admin, 'PATCH', `/roles/${roleId}`, {
      name: 'beta-2'
    });
    expect(renameRes.status).toBe(200);

    expect(roleNamesOf(flagId)).toEqual([['beta-2', 'staff'], ['beta-2']]);
    expect(versionOf(flagId)).toBe(versionBefore + 1);
    expect(await userSees(user, key)).toBe(true);

    const deleteRes = await call(admin, 'DELETE', `/roles/${roleId}`);
    expect(deleteRes.status).toBe(200);

    expect(roleNamesOf(flagId)).toEqual([['staff'], []]);
    expect(versionOf(flagId)).toBe(versionBefore + 2);
    expect(await userSees(user, key)).toBe(false);
  });

  it('leaves the flags alone when no rule names the role', async () => {
    const { admin, roleId, flagId } = await setUp([['staff']]);
    const versionBefore = versionOf(flagId);

    await call(admin, 'PATCH', `/roles/${roleId}`, { name: 'beta-2' });
    await call(admin, 'DELETE', `/roles/${roleId}`);

    expect(roleNamesOf(flagId)).toEqual([['staff']]);
    expect(versionOf(flagId)).toBe(versionBefore);
  });
});
