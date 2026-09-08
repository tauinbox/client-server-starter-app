import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
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

async function loginAsUser(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function permissionsOf(token: string): Promise<{
  roles: string[];
  rules: unknown[][];
}> {
  const res = await fetch(`${baseUrl}/api/v1/auth/permissions`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { roles: string[]; rules: unknown[][] };
}

describe('seeded user role parity with the server RBAC seeder', () => {
  it('grants read and update on Profile and nothing else on that subject', async () => {
    const body = await permissionsOf(await loginAsUser());

    expect(body.roles).toEqual(['user']);
    const profileActions = body.rules
      .filter((rule) => rule[1] === 'Profile')
      .map((rule) => rule[0]);

    expect(profileActions.sort()).toEqual(['read', 'update']);
  });

  it('grants update on User restricted to the caller own record', async () => {
    const body = await permissionsOf(await loginAsUser());

    const userRules = body.rules.filter((rule) => rule[1] === 'User');

    expect(userRules).toEqual([['update', 'User', { id: mockId('user-2') }]]);
  });

  // Rule order follows the seeded permission table and is not a parity
  // property, so the set is compared instead.
  it('packs exactly the three seeded rules and no more', async () => {
    const body = await permissionsOf(await loginAsUser());

    const sorted = [...body.rules].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    );

    expect(sorted).toEqual([
      ['read', 'Profile'],
      ['update', 'Profile'],
      ['update', 'User', { id: mockId('user-2') }]
    ]);
  });
});
