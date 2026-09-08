import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { createClient } from '@keyv/redis';
import { buildCacheOptions } from '../src/modules/core/redis-cache.store';
import { SingleUseTokenLedger } from '../src/common/utils/single-use-token-ledger';

const REDIS_URL = process.env['REDIS_URL'];
const KEY_PREFIX = 'e2e-ledger:spent:';
const CLAIM_ID = 'token-id';

// The ledger refuses a replay with a conditional Redis write, and the property
// it buys is that simultaneous presentations cannot both win. A mocked client
// cannot prove that. Skipped when REDIS_URL is unset (CI has no Redis service).
const runWithRedis = REDIS_URL ? describe : describe.skip;

runWithRedis('single-use token ledger (real Redis)', () => {
  let moduleRef: TestingModule;
  let cache: Cache;
  let ledger: SingleUseTokenLedger;
  let redis: ReturnType<typeof createClient>;

  beforeAll(async () => {
    redis = createClient({ url: REDIS_URL });
    await redis.connect();

    moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.registerAsync({
          useFactory: () => buildCacheOptions(REDIS_URL)
        })
      ]
    }).compile();

    cache = moduleRef.get<Cache>(CACHE_MANAGER);
    // Firing the burst at a lazily-connecting client makes every command fail
    // at once, which would silently measure the connect instead of the claim.
    await cache.get('e2e-ledger:warmup');
    ledger = new SingleUseTokenLedger(cache, KEY_PREFIX, new Logger('test'));
  });

  afterAll(async () => {
    await redis.del(`${KEY_PREFIX}${CLAIM_ID}`);
    await redis.quit();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await redis.del(`${KEY_PREFIX}${CLAIM_ID}`);
  });

  it('grants exactly one of many simultaneous claims', async () => {
    // A read-then-write ledger loses this race, and the race is the one a
    // replay of a captured value fires on purpose.
    const results = await Promise.all(
      Array.from({ length: 25 }, () => ledger.claim(CLAIM_ID, 60_000))
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('refuses a later replay and bounds the record by the ttl', async () => {
    expect(await ledger.claim(CLAIM_ID, 60_000)).toBe(true);
    expect(await ledger.claim(CLAIM_ID, 60_000)).toBe(false);

    const ttl = await redis.pTTL(`${KEY_PREFIX}${CLAIM_ID}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  // The claim is deliberately outside the Keyv JSON envelope, which is what
  // makes the conditional write possible - the same split the version counter
  // relies on, so the two representations never collide.
  it('writes the claim outside the cache-manager envelope', async () => {
    await ledger.claim(CLAIM_ID, 60_000);

    expect(await redis.get(`${KEY_PREFIX}${CLAIM_ID}`)).toBe('1');
    expect(await cache.get(`${KEY_PREFIX}${CLAIM_ID}`)).toBeNull();
  });
});
