import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../app';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll((done) => {
  resetState();
  const app = createApp();
  server = app.listen(0, () => {
    const addr = server.address() as AddressInfo;
    baseUrl = `http://localhost:${addr.port}`;
    done();
  });
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
        password: 'Password1'
      })
    });
    expect(res.status).toBe(201);

    await wait(100);
    adminStream.close();
    userStream.close();

    expect(adminStream.frames.join('')).toContain('user_crud_events');
    expect(userStream.frames.join('')).not.toContain('user_crud_events');
  });
});
