// Parity with the server's @IsString() validation on the user-search
// filter params: a duplicated query param (?q=a&q=b, parsed as an array)
// must be rejected 400, not coerced to "a,b".

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

async function loginAsAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Password1'
    })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function getUsers(
  token: string,
  pathAndQuery: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/users${pathAndQuery}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

describe('User list/search filter-param validation parity with server', () => {
  it.each(['q', 'email', 'firstName', 'lastName', 'role'])(
    'rejects an array-valued %s on GET /users/search with 400',
    async (field) => {
      const token = await loginAsAdmin();

      const res = await getUsers(token, `/search?${field}=a&${field}=b`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(`${field} must be a string`);
    }
  );

  it.each([
    ['?q=a&q=b'],
    ['/cursor?email=a&email=b'],
    ['/search/cursor?role=a&role=b']
  ])('rejects an array-valued filter on GET /users%s with 400', async (url) => {
    const token = await loginAsAdmin();

    const res = await getUsers(token, url);

    expect(res.status).toBe(400);
  });

  it('accepts scalar filters on GET /users/search', async () => {
    const token = await loginAsAdmin();

    const res = await getUsers(token, '/search?q=admin&role=admin');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string }[] };
    expect(body.data.some((u) => u.email === 'admin@example.com')).toBe(true);
  });
});
