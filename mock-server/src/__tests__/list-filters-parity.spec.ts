// Parity with the server's list query DTOs (ListQueryDto) and applyListQuery:
// the same params are accepted and filtered, and the same inputs are a 400
// with the messages in the order list-query.dto.spec.ts pins on the server.

import type { Server } from 'http';
import { MAX_LIST_FILTER_LENGTH } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';

let server: Server;
let baseUrl: string;
let token: string;

beforeAll(async () => {
  resetState();
  const app = createApp();
  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(async () => {
  resetState();
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  const body = (await res.json()) as { tokens: { access_token: string } };
  token = body.tokens.access_token;
});

async function get(
  path: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>
  };
}

async function rows<T>(path: string): Promise<T[]> {
  const { status, body } = await get(path);
  expect(status).toBe(200);
  return body['data'] as T[];
}

/** Walks every page with `limit=1`, as the infinite scroll does. */
async function allPages<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const { status, body } = await get(
      `${path}${sep}limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    );
    expect(status).toBe(200);
    out.push(...(body['data'] as T[]));
    cursor = (body['meta'] as { nextCursor: string | null }).nextCursor;
  } while (cursor);
  return out;
}

type MockUserLike = {
  totpEnabledAt: string | null;
  password: string | null;
  isEmailVerified: boolean;
  lockedUntil: string | null;
};

const LISTS = [
  ['/admin/feature-flags/cursor', 'enabled'],
  ['/roles/cursor', 'isSystem'],
  ['/rbac/resources/cursor', 'isOrphaned']
] as const;

describe('list search and filters', () => {
  describe('feature flags', () => {
    it('matches q on key or description, case-insensitive', async () => {
      const flags = Array.from(getState().featureFlags.values());
      const target = flags[0];
      const needle = target.key.slice(1, 5).toUpperCase();
      const expected = flags
        .filter(
          (f) =>
            f.key.toLowerCase().includes(needle.toLowerCase()) ||
            (f.description ?? '').toLowerCase().includes(needle.toLowerCase())
        )
        .map((f) => f.id)
        .sort();

      const found = await allPages<{ id: string }>(
        `/admin/feature-flags/cursor?q=${needle}`
      );

      expect(found.map((f) => f.id).sort()).toEqual(expected);
      expect(expected).toContain(target.id);
    });

    it('filters on enabled and public together', async () => {
      const flags = Array.from(getState().featureFlags.values());
      const expected = flags
        .filter((f) => !f.enabled && !f.public)
        .map((f) => f.id)
        .sort();

      const found = await allPages<{ id: string }>(
        '/admin/feature-flags/cursor?enabled=false&public=false'
      );

      expect(found.map((f) => f.id).sort()).toEqual(expected);
    });

    it('filters on environment: an empty list applies everywhere', async () => {
      const flags = Array.from(getState().featureFlags.values());
      flags[0].environments = [];
      flags[1].environments = ['production'];
      flags[2].environments = ['staging'];
      const expected = flags
        .filter(
          (f) =>
            f.environments.length === 0 || f.environments.includes('production')
        )
        .map((f) => f.id)
        .sort();

      const found = await allPages<{ id: string }>(
        '/admin/feature-flags/cursor?environment=production'
      );

      expect(found.map((f) => f.id).sort()).toEqual(expected);
      expect(expected).toContain(flags[0].id);
      expect(expected).not.toContain(flags[2].id);
    });

    it('rejects an environment outside the list with the server message', async () => {
      const { status, body } = await get(
        '/admin/feature-flags/cursor?environment=prod'
      );

      expect(status).toBe(400);
      expect(body['errors']).toEqual([
        'environment must be one of the following values: local, development, staging, production'
      ]);
    });

    it('returns no row for a search that matches nothing', async () => {
      await expect(
        rows('/admin/feature-flags/cursor?q=zz-no-such-flag')
      ).resolves.toEqual([]);
    });
  });

  describe('roles', () => {
    it('filters on isSystem and searches name and description', async () => {
      const roles = Array.from(getState().roles.values());
      const custom = roles.filter((r) => !r.isSystem).map((r) => r.id);
      const system = roles.filter((r) => r.isSystem);

      const foundCustom = await allPages<{ id: string }>(
        '/roles/cursor?isSystem=false'
      );
      const foundByName = await rows<{ id: string }>(
        `/roles/cursor?q=${system[0].name.toUpperCase()}&isSystem=true`
      );

      expect(foundCustom.map((r) => r.id).sort()).toEqual(custom.sort());
      expect(foundByName.map((r) => r.id)).toContain(system[0].id);
    });
  });

  describe('resources', () => {
    it('filters on isOrphaned and isSystem and searches the subject', async () => {
      const resources = Array.from(getState().resources.values());
      const target = resources[0];
      target.isOrphaned = true;
      const orphaned = resources.filter((r) => r.isOrphaned).map((r) => r.id);

      const foundOrphaned = await allPages<{ id: string }>(
        '/rbac/resources/cursor?isOrphaned=true'
      );
      const foundBySubject = await rows<{ id: string }>(
        `/rbac/resources/cursor?q=${target.subject.toLowerCase()}&isOrphaned=true&isSystem=${String(target.isSystem)}`
      );

      expect(foundOrphaned.map((r) => r.id).sort()).toEqual(orphaned.sort());
      expect(foundBySubject.map((r) => r.id)).toEqual([target.id]);
    });

    it('never matches q against a NULL description', async () => {
      const resources = Array.from(getState().resources.values());
      for (const r of resources) r.description = null;

      await expect(rows('/rbac/resources/cursor?q=null')).resolves.toEqual([]);
    });
  });

  describe('users account state', () => {
    function emails(users: { email: string }[]): string[] {
      return users.map((u) => u.email).sort();
    }

    it.each([
      ['mfaEnabled=true', (u: MockUserLike) => u.totpEnabledAt !== null],
      ['mfaEnabled=false', (u: MockUserLike) => u.totpEnabledAt === null],
      ['hasPassword=false', (u: MockUserLike) => u.password === null],
      ['isEmailVerified=false', (u: MockUserLike) => !u.isEmailVerified],
      [
        'isLocked=true',
        (u: MockUserLike) =>
          u.lockedUntil !== null && Date.parse(u.lockedUntil) > Date.now()
      ],
      [
        'isLocked=false',
        (u: MockUserLike) =>
          u.lockedUntil === null || Date.parse(u.lockedUntil) <= Date.now()
      ]
    ])('%s returns the matching users', async (filter, predicate) => {
      const users = Array.from(getState().users.values());
      const [first, second, third] = users;
      first.totpEnabledAt = new Date().toISOString();
      second.password = null;
      second.isEmailVerified = false;
      second.lockedUntil = new Date(Date.now() + 60_000).toISOString();
      third.lockedUntil = new Date(Date.now() - 60_000).toISOString();
      const expected = users
        .filter((u) => !u.deletedAt)
        .filter(predicate)
        .map((u) => u.email)
        .sort();

      const found = await allPages<{ email: string }>(
        `/users/search/cursor?${filter}`
      );

      expect(emails(found)).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
    });

    it('rejects a non-boolean account-state filter', async () => {
      const { status, body } = await get('/users/search/cursor?isLocked=soon');

      expect(status).toBe(400);
      expect(body['errors']).toEqual(['isLocked must be a boolean value']);
    });
  });

  describe.each(LISTS)('validation of %s', (path, booleanFilter) => {
    it('rejects an array-valued q with both server messages', async () => {
      const { status, body } = await get(`${path}?q=a&q=b`);

      expect(status).toBe(400);
      expect(body['errors']).toEqual([
        `q must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`,
        'q must be a string'
      ]);
    });

    it('rejects an over-long q and accepts one at the cap', async () => {
      const over = await get(
        `${path}?q=${'x'.repeat(MAX_LIST_FILTER_LENGTH + 1)}`
      );
      const atCap = await get(
        `${path}?q=${'x'.repeat(MAX_LIST_FILTER_LENGTH)}`
      );

      expect(over.status).toBe(400);
      expect(over.body['errors']).toEqual([
        `q must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`
      ]);
      expect(atCap.status).toBe(200);
    });

    it('rejects a non-boolean filter and reads an empty one as unset', async () => {
      const bad = await get(`${path}?${booleanFilter}=yes`);
      const empty = await get(`${path}?${booleanFilter}=`);
      const none = await get(path);

      expect(bad.status).toBe(400);
      expect(bad.body['errors']).toEqual([
        `${booleanFilter} must be a boolean value`
      ]);
      expect(empty.status).toBe(200);
      expect(empty.body['data']).toEqual(none.body['data']);
    });

    it('rejects a param that the list does not declare', async () => {
      const { status, body } = await get(`${path}?role=admin`);

      expect(status).toBe(400);
      expect(body['errors']).toEqual(['property role should not exist']);
    });
  });

  it('reports q before the filters, in definition order, as the server does', async () => {
    const { body } = await get(
      '/rbac/resources/cursor?isOrphaned=maybe&q=a&q=b&isSystem=yes'
    );

    expect(body['errors']).toEqual([
      `q must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`,
      'q must be a string',
      'isSystem must be a boolean value',
      'isOrphaned must be a boolean value'
    ]);
  });
});
