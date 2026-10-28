import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';

// Mirrors UsersService.findOne, UsersService.remove and
// RoleService.loadRoleAssignmentTarget: an unknown user id answers 404 with
// the id in the message.

let server: Server;
let baseUrl: string;

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000999';

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

const anyRoleId = (): string => {
  const role = [...getState().roles.values()][0];
  if (!role) throw new Error('Seed roles');
  return role.id;
};

const routes: [string, string, () => unknown][] = [
  ['GET', `users/${UNKNOWN_ID}`, () => undefined],
  ['GET', `users/${UNKNOWN_ID}/permissions`, () => undefined],
  ['PATCH', `users/${UNKNOWN_ID}`, () => ({ name: 'Changed' })],
  ['DELETE', `users/${UNKNOWN_ID}`, () => undefined],
  ['POST', `users/${UNKNOWN_ID}/restore`, () => undefined],
  ['POST', `users/${UNKNOWN_ID}/mfa/reset`, () => undefined],
  ['POST', `users/${UNKNOWN_ID}/sessions/revoke`, () => undefined],
  ['POST', `roles/assign/${UNKNOWN_ID}`, () => ({ roleId: anyRoleId() })],
  ['DELETE', `roles/assign/${UNKNOWN_ID}/:roleId`, () => undefined]
];

describe('an unknown user id', () => {
  it.each(routes)(
    '%s /%s answers 404 with the id in the message',
    async (method, path, body) => {
      const payload = body();
      const url = `${baseUrl}/api/v1/${path.replace(':roleId', anyRoleId())}`;
      const res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${await adminToken()}`,
          ...(payload === undefined
            ? {}
            : { 'content-type': 'application/json' })
        },
        body: payload === undefined ? undefined : JSON.stringify(payload)
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        errorKey: 'errors.users.notFound',
        message: `User with ID ${UNKNOWN_ID} not found`
      });
    }
  );
});
