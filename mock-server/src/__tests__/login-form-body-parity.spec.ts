import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

// Mirrors the server's JSON-only body config: a form-encoded login, the shape
// a cross-site HTML form sends, must not sign anybody in.

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

function login(contentType: string, body: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body
  });
}

it('refuses a form-encoded login and sets no session cookie', async () => {
  const res = await login(
    'application/x-www-form-urlencoded',
    'email=user%40example.com&password=Password1'
  );

  expect(res.status).toBe(401);
  expect(res.headers.get('set-cookie') ?? '').not.toContain('refresh_token=');
});

it('still signs in with a JSON body', async () => {
  const res = await login(
    'application/json',
    JSON.stringify({ email: 'user@example.com', password: 'Password1' })
  );

  expect(res.status).toBe(200);
  expect(res.headers.get('set-cookie') ?? '').toContain('refresh_token=');
});
