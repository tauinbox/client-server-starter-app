import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors ResourceService.restore and UsersService.restore: a restore of a
// record that is not orphaned or not deleted answers 409 before any effect.

let server: Server;
let baseUrl: string;

const USERS_RESOURCE_ID = mockId('res-users');

beforeAll(async () => {
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
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Password1'
    })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function restore(
  path: string
): Promise<{ status: number; errorKey?: string }> {
  const res = await fetch(`${baseUrl}/api/v1/${path}/restore`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await adminToken()}` }
  });
  const body = (await res.json()) as { errorKey?: string };
  return { status: res.status, errorKey: body.errorKey };
}

const auditCount = (action: string, targetId: string): number =>
  getState().auditLogs.filter(
    (row) => row.action === action && row.targetId === targetId
  ).length;

const regularUser = () => {
  const user = [...getState().users.values()].find(
    (u) => u.email === 'user@example.com'
  );
  if (!user) throw new Error('Seed user user@example.com');
  return user;
};

describe('restore of a record that is not removed', () => {
  it('refuses a resource that is not orphaned with no audit row', async () => {
    expect(await restore(`rbac/resources/${USERS_RESOURCE_ID}`)).toEqual({
      status: 409,
      errorKey: 'errors.resources.notOrphaned'
    });
    expect(auditCount('RESOURCE_RESTORE', USERS_RESOURCE_ID)).toBe(0);
  });

  it('refuses a user that is not deleted with no audit row', async () => {
    const user = regularUser();

    expect(await restore(`users/${user.id}`)).toEqual({
      status: 409,
      errorKey: 'errors.users.notDeleted'
    });
    expect(auditCount('USER_RESTORE', user.id)).toBe(0);
  });

  it('restores a deleted user once, then refuses the second restore', async () => {
    const user = regularUser();
    user.deletedAt = '2025-01-01T00:00:00.000Z';

    expect((await restore(`users/${user.id}`)).status).toBe(200);
    expect(user.deletedAt).toBeNull();
    expect((await restore(`users/${user.id}`)).status).toBe(409);
    expect(auditCount('USER_RESTORE', user.id)).toBe(1);
  });
});
