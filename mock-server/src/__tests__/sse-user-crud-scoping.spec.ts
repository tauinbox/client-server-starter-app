import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

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

interface OpenStream {
  frames: string[];
  close: () => void;
}

async function openStream(token: string): Promise<OpenStream> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1/notifications/stream`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal
  });
  expect(res.status).toBe(200);

  const frames: string[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        frames.push(decoder.decode(value));
      }
    } catch {
      // stream aborted by close() - expected
    }
  })();

  return { frames, close: () => controller.abort() };
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('SSE user_crud_events scoping', () => {
  it('delivers user_crud_events only to admins', async () => {
    const adminToken = await login('admin@example.com');
    const userToken = await login('user@example.com');

    const adminStream = await openStream(adminToken);
    const userStream = await openStream(userToken);

    const res = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email: 'sse-created@example.com',
        firstName: 'Sse',
        lastName: 'Created',
        password: 'Sunrise-Kettle-19'
      })
    });
    expect(res.status).toBe(201);

    await wait(100);
    adminStream.close();
    userStream.close();

    expect(adminStream.frames.join('')).toContain('user_crud_events');
    expect(userStream.frames.join('')).not.toContain('user_crud_events');
  });

  it('applies the conditions of a search:User grant to the user of the event', async () => {
    const state = getState();
    const viewer = findUserByEmail('user@example.com')!;
    const other = findUserByEmail('admin@example.com')!;
    const resourceId = [...state.resources.values()].find(
      (r) => r.subject === 'User'
    )!.id;
    const actionId = [...state.actions.values()].find(
      (a) => a.name === 'search'
    )!.id;
    const permission = [...state.permissions.values()].find(
      (p) => p.resourceId === resourceId && p.actionId === actionId
    )!;
    state.roles.set('role-own-search', {
      id: 'role-own-search',
      name: 'own-search',
      description: null,
      isSystem: false,
      isSuper: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    });
    state.rolePermissions.push({
      id: 'rp-own-search',
      roleId: 'role-own-search',
      permissionId: permission.id,
      conditions: { ownership: { userField: 'id' } }
    });
    viewer.roles = [...viewer.roles, 'own-search'];

    const adminToken = await login('admin@example.com');
    const viewerStream = await openStream(await login('user@example.com'));

    const patch = (id: string) =>
      fetch(`${baseUrl}/api/v1/users/${id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ firstName: 'Changed' })
      });
    expect((await patch(other.id)).status).toBe(200);
    expect((await patch(viewer.id)).status).toBe(200);

    await wait(100);
    viewerStream.close();

    const frames = viewerStream.frames.join('');
    expect(frames).toContain(
      JSON.stringify({
        type: 'user_crud_events',
        action: 'updated',
        userId: viewer.id
      })
    );
    expect(frames).not.toContain(other.id);
  });
});
