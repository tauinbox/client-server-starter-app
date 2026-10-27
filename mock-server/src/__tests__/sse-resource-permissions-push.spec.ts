import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors ResourceService and the ResourceActionsChangedEvent listener: a
// committed change of the grantable actions of a resource sends one
// permissions_updated to every connected user.

const USERS_RESOURCE_ID = mockId('res-users');

let server: Server;
let baseUrl: string;
const openStreams: { close: () => void }[] = [];

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
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

async function openStream(token: string): Promise<() => number> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1/notifications/stream`, {
    headers: { authorization: `Bearer ${token}` },
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
  openStreams.push({ close: () => controller.abort() });

  return () =>
    body
      .split('\n')
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice(6)) as { type: string })
      .filter((e) => e.type === 'permissions_updated').length;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function call(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<number> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return res.status;
}

async function pushesAfter(
  write: (adminToken: string) => Promise<number>
): Promise<number> {
  const admin = await login('admin@example.com');
  const pushes = await openStream(await login('user@example.com'));
  expect(await write(admin)).toBe(200);
  await wait(100);
  return pushes();
}

describe('permissions_updated after a resource write', () => {
  it('is sent once for a narrowing of the users resource', async () => {
    expect(
      await pushesAfter((token) =>
        call('PATCH', `/rbac/resources/${USERS_RESOURCE_ID}`, token, {
          allowedActionNames: ['read', 'search']
        })
      )
    ).toBe(1);
  });

  it('is not sent when the grantable actions stay the same', async () => {
    const declared = getState().resources.get(USERS_RESOURCE_ID)!.actionNames;
    expect(
      await pushesAfter(async (token) => {
        const statuses = [
          await call('PATCH', `/rbac/resources/${USERS_RESOURCE_ID}`, token, {
            displayName: 'Members'
          }),
          await call('PATCH', `/rbac/resources/${USERS_RESOURCE_ID}`, token, {
            allowedActionNames: [...declared].reverse()
          })
        ];
        return statuses.every((status) => status === 200) ? 200 : 500;
      })
    ).toBe(0);
  });

  it('is sent once for the restore of an orphaned resource', async () => {
    getState().resources.get(USERS_RESOURCE_ID)!.isOrphaned = true;
    expect(
      await pushesAfter((token) =>
        call('POST', `/rbac/resources/${USERS_RESOURCE_ID}/restore`, token)
      )
    ).toBe(1);
  });

  it('is not sent for the refused restore of a resource that is not orphaned', async () => {
    expect(
      await pushesAfter(async (token) => {
        const status = await call(
          'POST',
          `/rbac/resources/${USERS_RESOURCE_ID}/restore`,
          token
        );
        return status === 409 ? 200 : 500;
      })
    ).toBe(0);
  });
});
