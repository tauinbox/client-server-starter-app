import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, resetState, revokeUserSessions } from '../state';

const HEARTBEAT_MS = 100;
const USER_EMAIL = 'user@example.com';
const HEARTBEAT_FRAME = 'data: \n\n';

let server: Server;
let baseUrl: string;
const previousHeartbeat = process.env['MOCK_SSE_HEARTBEAT_MS'];

type Session = { accessToken: string; refreshCookie: string };

interface OpenStream {
  body: () => string;
  ended: () => boolean;
  close: () => void;
}

const streams: OpenStream[] = [];

beforeAll(async () => {
  process.env['MOCK_SSE_HEARTBEAT_MS'] = String(HEARTBEAT_MS);
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  if (previousHeartbeat === undefined) {
    delete process.env['MOCK_SSE_HEARTBEAT_MS'];
  } else {
    process.env['MOCK_SSE_HEARTBEAT_MS'] = previousHeartbeat;
  }
  server.close(done);
});

beforeEach(() => {
  resetState();
});

afterEach(() => {
  for (const stream of streams.splice(0)) stream.close();
});

async function signIn(): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: USER_EMAIL, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const match = /refresh_token=([^;]+)/.exec(
    res.headers.get('set-cookie') ?? ''
  );
  const body = (await res.json()) as { tokens: { access_token: string } };
  return {
    accessToken: body.tokens.access_token,
    refreshCookie: `refresh_token=${match?.[1] ?? ''}`
  };
}

async function openStream(token: string): Promise<OpenStream> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1/notifications/stream`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal
  });
  expect(res.status).toBe(200);

  let body = '';
  let ended = false;
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value);
      }
      ended = true;
    } catch {
      // stream aborted by close() - expected
    }
  })();

  const stream: OpenStream = {
    body: () => body,
    ended: () => ended,
    close: () => controller.abort()
  };
  streams.push(stream);
  return stream;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const invalidatedFrame = (userId: string): string =>
  `data: ${JSON.stringify({ type: 'session_invalidated', userId })}`;

describe('an SSE stream ends with its session', () => {
  it('ends the stream of a signed-out session and keeps the stream of another session', async () => {
    const userId = findUserByEmail(USER_EMAIL)!.id;
    const a = await signIn();
    const b = await signIn();
    const streamA = await openStream(a.accessToken);
    const streamB = await openStream(b.accessToken);

    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${a.accessToken}`,
        cookie: a.refreshCookie
      }
    });
    expect(logout.status).toBe(200);

    await wait(HEARTBEAT_MS * 4);

    expect(streamA.ended()).toBe(true);
    expect(streamA.body()).toContain(invalidatedFrame(userId));
    expect(streamB.ended()).toBe(false);
    expect(streamB.body()).not.toContain('session_invalidated');
  });

  it('ends every stream of the user when all sessions are revoked', async () => {
    const userId = findUserByEmail(USER_EMAIL)!.id;
    const a = await signIn();
    const stream = await openStream(a.accessToken);

    revokeUserSessions(userId);
    await wait(HEARTBEAT_MS * 4);

    expect(stream.ended()).toBe(true);
    expect(stream.body()).toContain(invalidatedFrame(userId));
  });

  it('keeps the stream of a live session open across heartbeats', async () => {
    const a = await signIn();
    const stream = await openStream(a.accessToken);

    await wait(HEARTBEAT_MS * 4);

    expect(stream.ended()).toBe(false);
    expect(stream.body()).toContain(HEARTBEAT_FRAME);
  });

  it('sends the heartbeat frame of the server at once, before the first interval', async () => {
    const a = await signIn();
    process.env['MOCK_SSE_HEARTBEAT_MS'] = '60000';
    try {
      const stream = await openStream(a.accessToken);
      for (let i = 0; i < 100 && !stream.body(); i++) await wait(10);

      expect(stream.body()).toBe(HEARTBEAT_FRAME);
    } finally {
      process.env['MOCK_SSE_HEARTBEAT_MS'] = String(HEARTBEAT_MS);
    }
  });
});
