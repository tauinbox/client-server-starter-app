import Redis from 'ioredis';
import { RedisThrottlerStorage } from '../src/modules/core/redis-throttler.storage';

const REDIS_URL = process.env['REDIS_URL'];
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

    expect(record).toMatchObject({ totalHits: 1, isBlocked: true });
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

    const hits = records.map((r) => r.totalHits).sort((a, b) => a - b);
    expect(hits).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(records.filter((r) => r.isBlocked)).toHaveLength(15);
  });
});
