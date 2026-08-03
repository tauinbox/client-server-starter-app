import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

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

function postLogin(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('POST /api/v1/auth/login email handling', () => {
  it('accepts the seeded address typed in a different case', async () => {
    const res = await postLogin({
      email: ' User@EXAMPLE.com ',
      password: 'Password1'
    });

    expect(res.status).toBe(200);
  });

  // The real route has no `@Body()` DTO (guards run before pipes), so a
  // malformed address is a failed credential rather than a validation error.
  it.each([
    ['a malformed address', { email: 'not-an-email', password: 'Password1' }],
    [
      'an over-long address',
      { email: `${'a'.repeat(250)}@x.com`, password: 'P1' }
    ],
    [
      'an over-long password',
      { email: 'user@example.com', password: 'a'.repeat(200) }
    ],
    ['a non-string address', { email: { $ne: null }, password: 'Password1' }]
  ])('answers 401 for %s', async (_label, body) => {
    const res = await postLogin(body);

    expect(res.status).toBe(401);
  });
});
