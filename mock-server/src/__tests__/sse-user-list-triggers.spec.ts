import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

const ROLE_ID = '6f1c2a4e-8d3b-4c5a-9e7f-1a2b3c4d5e6f';

let server: Server;
let baseUrl: string;
const openStreams: { close: () => void }[] = [];

beforeAll(async () => {
  resetState();
  const app = createApp();
  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

afterEach(() => {
  for (const stream of openStreams.splice(0)) stream.close();
});

beforeEach(() => {
  resetState();
  getState().roles.set(ROLE_ID, {
    id: ROLE_ID,
    name: 'extra',
    description: null,
    isSystem: false,
    isSuper: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  });
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
  events: () => { type: string }[];
  close: () => void;
}

async function openStream(email: string): Promise<OpenStream> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1/notifications/stream`, {
    headers: { authorization: `Bearer ${await login(email)}` },
    signal: controller.signal
  });
  expect(res.status).toBe(200);

  let body = '';
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value);
      }
    } catch {
      // stream aborted by close() - expected
    }
  })();

  const stream = {
    events: () =>
      body
        .split('\n')
        .filter((line) => line.startsWith('data: {'))
        .map((line) => JSON.parse(line.slice(6)) as { type: string })
        .filter(
          (e) => e.type === 'user_crud_events' || e.type === 'user_list_stale'
        ),
    close: () => controller.abort()
  };
  openStreams.push(stream);
  return stream;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown
): Promise<number> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return res.status;
}

const crud = (action: string, userId: string) => ({
  type: 'user_crud_events',
  action,
  userId
});

describe('SSE user list events outside the admin user routes', () => {
  it('sends created for a self-registration', async () => {
    const admin = await openStream('admin@example.com');
    const plain = await openStream('user@example.com');

    expect(
      await call('POST', '/auth/register', null, {
        email: 'sse-registered@example.com',
        password: 'Sunrise-Kettle-19',
        firstName: 'Self',
        lastName: 'Registered'
      })
    ).toBe(201);

    await wait(100);
    admin.close();
    plain.close();
    const id = findUserByEmail('sse-registered@example.com')!.id;
    expect(admin.events()).toEqual([crud('created', id)]);
    expect(plain.events()).toEqual([]);
  });

  it('sends updated for a role assign and a role remove', async () => {
    const target = findUserByEmail('user@example.com')!;
    const adminToken = await login('admin@example.com');
    const admin = await openStream('admin@example.com');

    expect(
      await call('POST', `/roles/assign/${target.id}`, adminToken, {
        roleId: ROLE_ID
      })
    ).toBe(201);
    expect(
      await call('DELETE', `/roles/assign/${target.id}/${ROLE_ID}`, adminToken)
    ).toBe(200);

    await wait(100);
    admin.close();
    expect(admin.events()).toEqual([
      crud('updated', target.id),
      crud('updated', target.id)
    ]);
  });

  it('sends updated for an own name change and not for a locale change', async () => {
    const target = findUserByEmail('user@example.com')!;
    const userToken = await login('user@example.com');
    const admin = await openStream('admin@example.com');

    expect(
      await call('PATCH', '/auth/profile', userToken, { locale: 'ru' })
    ).toBe(200);
    expect(
      await call('PATCH', '/auth/profile', userToken, { lastName: 'Renamed' })
    ).toBe(200);

    await wait(100);
    admin.close();
    expect(admin.events()).toEqual([crud('updated', target.id)]);
  });

  it('sends updated for a confirmed email change', async () => {
    const target = findUserByEmail('user@example.com')!;
    target.pendingEmail = 'sse-moved@example.com';
    target.pendingEmailExpiresAt = new Date(Date.now() + 60_000).toISOString();
    getState().pendingEmailTokens.set('sse-token', target.id);
    const admin = await openStream('admin@example.com');

    expect(
      await call('POST', '/auth/profile/email/confirm', null, {
        token: 'sse-token'
      })
    ).toBe(200);

    await wait(100);
    admin.close();
    expect(admin.events()).toEqual([crud('updated', target.id)]);
  });

  it('sends user_list_stale after a role rename and a role delete, only to list viewers', async () => {
    const adminToken = await login('admin@example.com');
    const admin = await openStream('admin@example.com');
    const plain = await openStream('user@example.com');

    expect(
      await call('PATCH', `/roles/${ROLE_ID}`, adminToken, { name: 'renamed' })
    ).toBe(200);
    expect(await call('DELETE', `/roles/${ROLE_ID}`, adminToken)).toBe(200);

    await wait(100);
    admin.close();
    plain.close();
    const stale = { type: 'user_list_stale' };
    expect(admin.events()).toEqual([stale, stale]);
    expect(plain.events()).toEqual([]);
  });
});
