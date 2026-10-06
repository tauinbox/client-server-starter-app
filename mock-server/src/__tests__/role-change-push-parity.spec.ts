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

// The server pushes both events for every UserRoleChangedEvent, from
// NotificationsListener and FeatureFlagChangedListener.
function expectRoleChangePushes(): void {
  expect(push.mock.calls).toEqual([
    [USER_ID, { type: 'permissions_updated', userId: USER_ID }],
    [USER_ID, { type: 'feature_flags_updated' }]
  ]);
}

describe('role change pushes parity with server', () => {
  it('pushes permissions and flags events on role assign', async () => {
    const token = await loginAsAdmin();

    const res = await post(
      `/api/v1/roles/assign/${USER_ID}`,
      { roleId: mockId('role-editor') },
      token
    );

    expect(res.status).toBe(201);
    expectRoleChangePushes();
  });

  it('pushes permissions and flags events on role unassign', async () => {
    const token = await loginAsAdmin();

    const res = await fetch(
      `${baseUrl}/api/v1/roles/assign/${USER_ID}/${mockId('role-user')}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }
    );

    expect(res.status).toBe(200);
    expectRoleChangePushes();
  });

  it('pushes both events from the change-user-roles control route', async () => {
    const res = await post('/__control/change-user-roles', {
      userId: USER_ID,
      newRoles: []
    });

    expect(res.status).toBe(200);
    expectRoleChangePushes();
  });

  it('pushes both events from the revoke-user-sessions control route', async () => {
    const res = await post('/__control/revoke-user-sessions', {
      userId: USER_ID
    });

    expect(res.status).toBe(200);
    expectRoleChangePushes();
  });
});
