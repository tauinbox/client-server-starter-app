import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { Test } from '@nestjs/testing';
import KeyvRedis from '@keyv/redis';
import type { Cache } from 'cache-manager';
import { buildCacheOptions, createRedisCacheStore } from './redis-cache.store';

const REDIS_URL = 'redis://localhost:6379';

// No connection is opened: the adapter connects lazily on the first command,
// and these assertions only inspect how the store is wired.
describe('buildCacheOptions', () => {
  it('returns no store when REDIS_URL is unset', () => {
    expect(buildCacheOptions(undefined)).toEqual({});
    expect(buildCacheOptions('')).toEqual({});
  });

  it('registers the Redis adapter under `stores` (plural)', () => {
    const options = buildCacheOptions(REDIS_URL);

    // A singular `store` type-checks but is silently dropped by the provider
    // factory, leaving an in-memory cache that looks healthy.
    expect(options).not.toHaveProperty('store');
    expect(options.stores).toEqual([expect.any(KeyvRedis)]);
  });

  it('wires the Redis adapter into the cache manager Nest resolves', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.registerAsync({
          useFactory: () => buildCacheOptions(REDIS_URL)
        })
      ]
    }).compile();

    const cache = moduleRef.get<Cache>(CACHE_MANAGER);

    // The assertion that fails when the adapter is dropped: an ignored store
    // leaves cache.stores backed by the default in-memory Keyv.
    expect(cache.stores).toHaveLength(1);
    expect(cache.stores[0].store).toBeInstanceOf(KeyvRedis);

    await moduleRef.close();
  });
});

describe('createRedisCacheStore', () => {
  it('bounds the connection attempt so an outage cannot hang a request', () => {
    const store = createRedisCacheStore(REDIS_URL);

    expect(store.connectionTimeout).toBe(1000);
    expect(store.throwOnConnectError).toBe(false);
  });
});
