import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
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

describe('API answers carry Cache-Control: no-store (NoStoreMiddleware parity)', () => {
  it('a JSON answer with personal data is no-store', async () => {
    const token = await signIn();
    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a refusal by the guard is no-store', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/profile`);

    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('the SSE stream keeps the Cache-Control of Nest', async () => {
    const token = await signIn();
    const controller = new AbortController();

    try {
      const res = await fetch(`${baseUrl}/api/v1/notifications/stream`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(
        'private, no-cache, no-store, must-revalidate, max-age=0, no-transform'
      );
    } finally {
      controller.abort();
    }
  });
});
