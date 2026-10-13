import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
import { mockId } from '../utils/mock-id';
import * as sseHub from '../sse-hub';

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

let push: jest.SpyInstance;

beforeEach(() => {
  resetState();
  push = jest.spyOn(sseHub, 'pushToUser');
});

afterEach(() => {
  push.mockRestore();
});

async function loginAsAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function post(
  path: string,
  body: object,
  token?: string
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

const USER_ID = mockId('user-2');

// An action that ends the sessions of the user pushes nothing to that user:
// the keep-alive check of the stream sends `session_invalidated`, as on the
// server.
function expectNoPushToTarget(): void {
  expect(push.mock.calls.filter(([userId]) => userId === USER_ID)).toEqual([]);
}

describe('session-ending actions push parity with server', () => {
  it('pushes nothing to the user on role assign', async () => {
    const token = await loginAsAdmin();

    const res = await post(
      `/api/v1/roles/assign/${USER_ID}`,
      { roleId: mockId('role-editor') },
      token
    );

    expect(res.status).toBe(201);
    expectNoPushToTarget();
  });

  it('pushes nothing to the user on role unassign', async () => {
    const token = await loginAsAdmin();

    const res = await fetch(
      `${baseUrl}/api/v1/roles/assign/${USER_ID}/${mockId('role-user')}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }
    );

    expect(res.status).toBe(200);
    expectNoPushToTarget();
  });

  it('pushes nothing to the user on an admin password change', async () => {
    const token = await loginAsAdmin();

    const res = await fetch(`${baseUrl}/api/v1/users/${USER_ID}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        password: 'Quartz-Lantern-82',
        currentPassword: 'Password1'
      })
    });

    expect(res.status).toBe(200);
    expectNoPushToTarget();
  });

  it('pushes nothing to the user on delete', async () => {
    const token = await loginAsAdmin();

    const res = await fetch(`${baseUrl}/api/v1/users/${USER_ID}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.status).toBe(200);
    expectNoPushToTarget();
  });

  it('pushes only permissions_updated from the change-user-roles control route', async () => {
    const res = await post('/__control/change-user-roles', {
      userId: USER_ID,
      newRoles: []
    });

    expect(res.status).toBe(200);
    expect(push.mock.calls).toEqual([
      [USER_ID, { type: 'permissions_updated' }]
    ]);
  });
});
