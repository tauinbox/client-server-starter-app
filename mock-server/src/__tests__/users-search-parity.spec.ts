// Parity with the server's SearchUsersCursorQueryDto: the mock must reject the same
// filter inputs with 400 instead of coercing or silently dropping them.

import type { Server } from 'http';
import { MAX_PAGE_SIZE, MAX_LIST_FILTER_LENGTH } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';

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
    'rejects an array-valued %s on GET /users/search/cursor with 400',
    async (field) => {
      const token = await loginAsAdmin();

      const res = await getUsers(token, `/search/cursor?${field}=a&${field}=b`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors).toEqual([
        `${field} must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`,
        `${field} must be a string`
      ]);
    }
  );

  // The order is pinned on the server by search-users-cursor-query.dto.spec.ts.
  it('reports the messages in the order the server does', async () => {
    const token = await loginAsAdmin();

    const res = await getUsers(
      token,
      '/search/cursor?includeDeleted=maybe&role=a&role=b&isActive=maybe&ids=nope&q=a&q=b'
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toEqual([
      `role must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`,
      'role must be a string',
      'includeDeleted must be a boolean value',
      `q must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`,
      'q must be a string',
      'each value in ids must be a UUID',
      'isActive must be a boolean value'
    ]);
  });

  it.each([
    ['/cursor?q=a&q=b'],
    ['/cursor?email=a&email=b'],
    ['/search/cursor?role=a&role=b']
  ])('rejects an array-valued filter on GET /users%s with 400', async (url) => {
    const token = await loginAsAdmin();

    const res = await getUsers(token, url);

    expect(res.status).toBe(400);
  });

  it.each(['q', 'email', 'firstName', 'lastName', 'role'])(
    'rejects an over-long %s on GET /users/search/cursor with 400',
    async (field) => {
      const token = await loginAsAdmin();

      const res = await getUsers(
        token,
        `/search/cursor?${field}=${'x'.repeat(MAX_LIST_FILTER_LENGTH + 1)}`
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(
        `${field} must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`
      );
    }
  );

  it.each(['isActive', 'includeDeleted'])(
    'rejects a non-boolean %s on GET /users/search/cursor with 400',
    async (field) => {
      const token = await loginAsAdmin();

      const res = await getUsers(token, `/search/cursor?${field}=maybe`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(`${field} must be a boolean value`);
    }
  );

  it.each([
    ['/cursor?includeDeleted=maybe'],
    ['/cursor?isActive=maybe'],
    ['/search/cursor?q=' + 'x'.repeat(MAX_LIST_FILTER_LENGTH + 1)]
  ])('rejects an invalid filter on GET /users%s with 400', async (url) => {
    const token = await loginAsAdmin();

    const res = await getUsers(token, url);

    expect(res.status).toBe(400);
  });

  it('reads an empty isActive as unset, like the DTO transform', async () => {
    const token = await loginAsAdmin();

    const withFilter = await getUsers(token, '/search/cursor?isActive=');
    const without = await getUsers(token, '/search/cursor');

    expect(withFilter.status).toBe(200);
    const filtered = (await withFilter.json()) as { data: unknown[] };
    const all = (await without.json()) as { data: unknown[] };
    expect(filtered.data.length).toBe(all.data.length);
  });

  it('accepts a filter exactly at the cap', async () => {
    const token = await loginAsAdmin();

    const res = await getUsers(
      token,
      `/search/cursor?q=${'x'.repeat(MAX_LIST_FILTER_LENGTH)}`
    );

    expect(res.status).toBe(200);
  });

  describe('ids', () => {
    function seededIds(): string[] {
      return Array.from(getState().users.values()).map((u) => u.id);
    }

    function returnedIds(body: unknown): string[] {
      return (body as { data: { id: string }[] }).data.map((u) => u.id).sort();
    }

    it.each(['/cursor', '/search/cursor'])(
      'returns exactly the listed users on GET /users%s',
      async (path) => {
        const token = await loginAsAdmin();
        const [first, second] = seededIds();

        const res = await getUsers(token, `${path}?ids=${first},${second}`);

        expect(res.status).toBe(200);
        expect(returnedIds(await res.json())).toEqual([first, second].sort());
      }
    );

    it('leaves out a soft-deleted user unless includeDeleted is set', async () => {
      const token = await loginAsAdmin();
      const [first, second] = seededIds();
      const deleted = getState().users.get(second);
      if (!deleted) throw new Error('seed user missing');
      deleted.deletedAt = new Date().toISOString();

      const live = await getUsers(
        token,
        `/search/cursor?ids=${first},${second}`
      );
      const all = await getUsers(
        token,
        `/search/cursor?ids=${first},${second}&includeDeleted=true`
      );

      expect(returnedIds(await live.json())).toEqual([first]);
      expect(returnedIds(await all.json())).toEqual([first, second].sort());
    });

    it.each([
      [
        'more than the page cap',
        () =>
          Array(MAX_PAGE_SIZE + 1)
            .fill(seededIds()[0])
            .join(','),
        `ids must contain no more than ${MAX_PAGE_SIZE} elements`
      ],
      [
        'a value that is not a UUID',
        () => `${seededIds()[0]},nope`,
        'each value in ids must be a UUID'
      ],
      ['an empty value', () => '', 'each value in ids must be a UUID']
    ])('rejects %s with the server message', async (_case, ids, message) => {
      const token = await loginAsAdmin();

      const res = await getUsers(token, `/search/cursor?ids=${ids()}`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(message);
    });

    it('reports the UUID check before the size, as the server does', async () => {
      const token = await loginAsAdmin();

      const res = await getUsers(
        token,
        `/search/cursor?ids=${Array(MAX_PAGE_SIZE + 1)
          .fill('nope')
          .join(',')}`
      );

      const body = (await res.json()) as { errors: string[] };
      expect(body.errors).toEqual([
        'each value in ids must be a UUID',
        `ids must contain no more than ${MAX_PAGE_SIZE} elements`
      ]);
    });
  });

  it('applies the filters on GET /users/cursor too, as the server does', async () => {
    const token = await loginAsAdmin();

    const res = await getUsers(token, '/cursor?q=admin@example.com');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string }[] };
    expect(body.data.map((u) => u.email)).toEqual(['admin@example.com']);
  });

  it('accepts scalar filters on GET /users/search/cursor', async () => {
    const token = await loginAsAdmin();

    const res = await getUsers(token, '/search/cursor?q=admin&role=admin');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string }[] };
    expect(body.data.some((u) => u.email === 'admin@example.com')).toBe(true);
  });
});
