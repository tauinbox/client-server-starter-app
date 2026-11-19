import Redis from 'ioredis';
import { RedisThrottlerStorage } from '../src/modules/core/redis-throttler.storage';

const { REDIS_URL } = process.env;
const KEY = 'e2e-throttler:login:203.0.113.7';
const BLOCK_KEY = `${KEY}:block`;

// Production keeps the login lockout and the rate limits in this storage, and
// the unit spec drives it with a mocked client. Skipped when REDIS_URL is unset.
const runWithRedis = REDIS_URL ? describe : describe.skip;

runWithRedis('Redis throttler storage (real Redis)', () => {
  let storage: RedisThrottlerStorage;
  let redis: Redis;

  beforeAll(() => {
    storage = new RedisThrottlerStorage(REDIS_URL!);
    redis = new Redis(REDIS_URL!);
  });

  afterAll(async () => {
    await redis.del(KEY, BLOCK_KEY);
    redis.disconnect();
    storage.disconnect();
  });

  beforeEach(async () => {
    await redis.del(KEY, BLOCK_KEY);
  });

  it('counts the hits of a window and gives the key an expiry', async () => {
    await storage.increment(KEY, 60_000, 3, 0, 'login');
    const record = await storage.increment(KEY, 60_000, 3, 0, 'login');

    expect(record).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(await redis.pttl(KEY)).toBeGreaterThan(0);
  });

  it('blocks above the limit for the block duration', async () => {
    for (let i = 0; i < 3; i++) {
      await storage.increment(KEY, 60_000, 3, 5_000, 'login');
    }

    const record = await storage.increment(KEY, 60_000, 3, 5_000, 'login');

    expect(record).toMatchObject({ totalHits: 4, isBlocked: true });
    expect(record.timeToBlockExpire).toBe(5);
    const blockTtl = await redis.pttl(BLOCK_KEY);

    expect(blockTtl).toBeGreaterThan(0);
    expect(blockTtl).toBeLessThanOrEqual(5_000);
  });

  it('keeps the block after the hits leave the window', async () => {
    for (let i = 0; i < 2; i++) {
      await storage.increment(KEY, 50, 1, 60_000, 'login');
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    const record = await storage.increment(KEY, 50, 1, 60_000, 'login');

    expect(record).toMatchObject({ isBlocked: true });
    // A call inside the block records no hit.
    expect(await redis.zcard(KEY)).toBe(0);
  });

  it('starts a new count once the window elapses', async () => {
    await storage.increment(KEY, 50, 5, 0, 'login');
    await storage.increment(KEY, 50, 5, 0, 'login');
    await new Promise((resolve) => setTimeout(resolve, 100));

    const record = await storage.increment(KEY, 50, 5, 0, 'login');

    expect(record).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('removes one hit on decrement', async () => {
    await storage.increment(KEY, 60_000, 5, 0, 'login');
    await storage.increment(KEY, 60_000, 5, 0, 'login');

    await storage.decrement(KEY);

    expect(await redis.zcard(KEY)).toBe(1);
  });

  it('counts every request of a simultaneous burst', async () => {
    const records = await Promise.all(
      Array.from({ length: 25 }, () =>
        storage.increment(KEY, 60_000, 10, 0, 'login')
      )
    );

    const hits = records.map((r) => r.totalHits).toSorted((a, b) => a - b);

    // The set keeps limit + 1 hits, so every count above that reads 11.
    expect(hits).toEqual([
      ...Array.from({ length: 10 }, (_, i) => i + 1),
      ...Array.from({ length: 15 }, () => 11)
    ]);
    expect(records.filter((r) => r.isBlocked)).toHaveLength(15);
  });

  it('records no hit while the key is blocked', async () => {
    for (let i = 0; i < 200; i++) {
      await storage.increment(KEY, 900_000, 5, 900_000, 'login');
    }

    expect(await redis.zcard(KEY)).toBe(6);
  });

  it('keeps the newest limit + 1 hits when no block is set', async () => {
    const records = [];

    for (let i = 0; i < 50; i++) {
      records.push(await storage.increment(KEY, 60_000, 3, 0, 'login'));
    }

    expect(await redis.zcard(KEY)).toBe(4);
    expect(records.filter((r) => r.isBlocked)).toHaveLength(47);
    expect(await redis.exists(BLOCK_KEY)).toBe(0);
  });

  it('refunds the newest hit after the set was trimmed', async () => {
    for (let i = 0; i < 10; i++) {
      await storage.increment(KEY, 60_000, 3, 0, 'login');
    }

    await storage.decrement(KEY);

    expect(await redis.zcard(KEY)).toBe(3);
    await expect(
      storage.increment(KEY, 60_000, 3, 0, 'login')
    ).resolves.toMatchObject({ totalHits: 4, isBlocked: true });
  });
});
