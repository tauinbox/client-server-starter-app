import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { createClient } from '@keyv/redis';
import { buildCacheOptions } from '../src/modules/core/redis-cache.store';
import { FailedAttemptCounter } from '../src/common/utils/failed-attempt-counter';

const REDIS_URL = process.env['REDIS_URL'];
const KEY_PREFIX = 'e2e-counter:failures:';
const SUBJECT_ID = 'user-id';
const KEY = `${KEY_PREFIX}${SUBJECT_ID}`;

// A counter key with no expiry bars the subject for ever, and only the real
// server shows whether the expiry is kept. Skipped when REDIS_URL is unset (CI
// has no Redis service).
const runWithRedis = REDIS_URL ? describe : describe.skip;

runWithRedis('failed attempt counter (real Redis)', () => {
  let moduleRef: TestingModule;
  let counter: FailedAttemptCounter;
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

    const cache = moduleRef.get<Cache>(CACHE_MANAGER);
    await cache.get('e2e-counter:warmup');
    counter = new FailedAttemptCounter(cache, KEY_PREFIX, new Logger('test'));
  });

  afterAll(async () => {
    await redis.del(KEY);
    await redis.quit();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await redis.del(KEY);
  });

  it('opens a window that expires', async () => {
    const window = await counter.record(SUBJECT_ID, 60_000);

    expect(window.count).toBe(1);
    expect(window.remainingMs).toBeGreaterThan(0);
    expect(window.remainingMs).toBeLessThanOrEqual(60_000);
    expect(await redis.pTTL(KEY)).toBeGreaterThan(0);
  });

  it('does not extend the window on a later failure', async () => {
    await counter.record(SUBJECT_ID, 60_000);
    await redis.pExpire(KEY, 30_000);

    const window = await counter.record(SUBJECT_ID, 60_000);

    expect(window.count).toBe(2);
    expect(window.remainingMs).toBeLessThanOrEqual(30_000);
  });

  it('gives an expiry to a key that has none', async () => {
    await redis.set(KEY, '7');

    const window = await counter.record(SUBJECT_ID, 60_000);

    expect(window.count).toBe(8);
    expect(window.remainingMs).toBeGreaterThan(0);
    expect(await redis.pTTL(KEY)).toBeGreaterThan(0);
  });

  it('starts a new count once the window elapses', async () => {
    await counter.record(SUBJECT_ID, 50);
    await counter.record(SUBJECT_ID, 50);
    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect(counter.record(SUBJECT_ID, 50)).resolves.toMatchObject({
      count: 1
    });
  });

  it('counts every request of a simultaneous burst', async () => {
    const windows = await Promise.all(
      Array.from({ length: 25 }, () => counter.record(SUBJECT_ID, 60_000))
    );

    expect(Math.max(...windows.map((w) => w.count))).toBe(25);
    expect(await redis.pTTL(KEY)).toBeGreaterThan(0);
  });
});
