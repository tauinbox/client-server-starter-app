import type { Server } from 'http';
import { MAX_SSE_STREAMS_PER_USER } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, resetState } from '../state';
import { countSseConnections } from '../sse-hub';

let server: Server;
let baseUrl: string;
const controllers: AbortController[] = [];

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
});

async function signIn(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function requestStream(token: string): Promise<Response> {
  const controller = new AbortController();
  controllers.push(controller);
  return fetch(`${baseUrl}/api/v1/notifications/stream`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal
  });
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('the open SSE streams of one user are limited', () => {
  it('refuses the stream over the limit with 429 and accepts one again after a stream closes', async () => {
    const userId = findUserByEmail('user@example.com')!.id;
    const token = await signIn();

    for (let i = 0; i < MAX_SSE_STREAMS_PER_USER; i++) {
      expect((await requestStream(token)).status).toBe(200);
    }

    const refused = await requestStream(token);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      statusCode: 429,
      message: 'Too many open notification streams',
      error: 'Too Many Requests'
    });

    controllers[0].abort();
    for (let i = 0; i < 50; i++) {
      if (countSseConnections(userId) < MAX_SSE_STREAMS_PER_USER) break;
      await wait(20);
    }
    expect((await requestStream(token)).status).toBe(200);
  });
});
