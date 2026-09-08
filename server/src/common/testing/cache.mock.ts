import type { Cache } from 'cache-manager';

/**
 * Builds a Map-backed stand-in for the injected `Cache`. It keeps values, so a
 * test that asserts on a second read (a single-use ledger, a warm hit) sees the
 * first write. `stores` is deliberately empty: no Redis client sits behind it,
 * which is the in-memory branch every consumer must still work on. TTL is
 * accepted and ignored - no unit test in this repository waits for one.
 */
export function createMockCache(): Cache {
  const entries = new Map<string, unknown>();

  const cache = {
    stores: [],
    get: jest.fn((key: string) => Promise.resolve(entries.get(key) ?? null)),
    set: jest.fn((key: string, value: unknown) => {
      entries.set(key, value);
      return Promise.resolve(value);
    }),
    del: jest.fn((key: string) => Promise.resolve(entries.delete(key)))
  };

  // @ts-expect-error - partial Cache: tests only use get/set/del and stores
  return cache;
}
