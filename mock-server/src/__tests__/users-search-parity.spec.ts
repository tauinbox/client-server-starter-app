// Parity with the server's UserFiltersQueryDto: the mock must reject the same
// filter inputs with 400 instead of coercing or silently dropping them.

import type { Server } from 'http';
import { MAX_USER_FILTER_LENGTH } from '@app/shared/constants';
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

  it.each(['q', 'email', 'firstName', 'lastName', 'role'])(
    'rejects an over-long %s on GET /users/search with 400',
    async (field) => {
      const token = await loginAsAdmin();

      const res = await getUsers(
        token,
        `/search?${field}=${'x'.repeat(MAX_USER_FILTER_LENGTH + 1)}`
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(
        `${field} must be shorter than or equal to ${MAX_USER_FILTER_LENGTH} characters`
      );
    }
  );

  it.each(['isActive', 'includeDeleted'])(
    'rejects a non-boolean %s on GET /users/search with 400',
    async (field) => {
      const token = await loginAsAdmin();

      const res = await getUsers(token, `/search?${field}=maybe`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(`${field} must be a boolean value`);
    }
  );

  it.each([
    ['?includeDeleted=maybe'],
    ['/cursor?isActive=maybe'],
    ['/search/cursor?q=' + 'x'.repeat(MAX_USER_FILTER_LENGTH + 1)]
  ])('rejects an invalid filter on GET /users%s with 400', async (url) => {
    const token = await loginAsAdmin();

    const res = await getUsers(token, url);

    expect(res.status).toBe(400);
  });

  it('reads an empty isActive as unset, like the DTO transform', async () => {
    const token = await loginAsAdmin();

    const withFilter = await getUsers(token, '/search?isActive=');
    const without = await getUsers(token, '/search');

    expect(withFilter.status).toBe(200);
    const filtered = (await withFilter.json()) as { data: unknown[] };
    const all = (await without.json()) as { data: unknown[] };
    expect(filtered.data.length).toBe(all.data.length);
  });

  it('accepts a filter exactly at the cap', async () => {
    const token = await loginAsAdmin();

    const res = await getUsers(
      token,
      `/search?q=${'x'.repeat(MAX_USER_FILTER_LENGTH)}`
    );

    expect(res.status).toBe(200);
  });

  it('accepts scalar filters on GET /users/search', async () => {
    const token = await loginAsAdmin();

    const res = await getUsers(token, '/search?q=admin&role=admin');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string }[] };
    expect(body.data.some((u) => u.email === 'admin@example.com')).toBe(true);
  });
});
