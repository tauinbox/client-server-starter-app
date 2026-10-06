import { MemoryThrottlerStorage } from './memory-throttler.storage';

const THROTTLER = 'login-long-window';
const KEY = 'key';
const LIMIT = 4;

describe('MemoryThrottlerStorage', () => {
  let storage: MemoryThrottlerStorage;

  const hit = (ttl = 60000): Promise<{ totalHits: number }> =>
    storage.increment(KEY, ttl, LIMIT, 0, THROTTLER);

  beforeEach(() => {
    storage = new MemoryThrottlerStorage();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
  });

  it('refunds a single hit', async () => {
    await hit();
    await hit();

    await storage.decrement(KEY);

    await expect(hit()).resolves.toMatchObject({ totalHits: 2 });
  });

  it('ignores a key that was never incremented', async () => {
    await expect(storage.decrement('unknown')).resolves.toBeUndefined();
  });

  it('never drops the counter below zero', async () => {
    await hit();

    await storage.decrement(KEY);
    await storage.decrement(KEY);

    await expect(hit()).resolves.toMatchObject({ totalHits: 1 });
  });

  it('does not let the expiry timer of a refunded hit widen the next window', async () => {
    const ttl = 50;
    await hit(ttl);
    await storage.decrement(KEY);

    await new Promise((resolve) => setTimeout(resolve, ttl * 2));

    await expect(hit(ttl)).resolves.toMatchObject({ totalHits: 1 });
  });

  it('keeps the older hits of the window when it refunds the newest', async () => {
    const ttl = 50;
    await hit(ttl);
    await new Promise((resolve) => setTimeout(resolve, ttl / 2));
    await hit(ttl);
    await storage.decrement(KEY);

    await new Promise((resolve) => setTimeout(resolve, ttl));

    await expect(hit(ttl)).resolves.toMatchObject({ totalHits: 1 });
  });

  it('reports the window in seconds', async () => {
    await expect(hit(60000)).resolves.toMatchObject({
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0
    });
  });

  it('blocks above the limit for the block duration, in seconds', async () => {
    const blockDuration = 30000;
    for (let i = 0; i < LIMIT; i++) {
      await storage.increment(KEY, 60000, LIMIT, blockDuration, THROTTLER);
    }

    await expect(
      storage.increment(KEY, 60000, LIMIT, blockDuration, THROTTLER)
    ).resolves.toMatchObject({
      totalHits: LIMIT + 1,
      isBlocked: true,
      timeToBlockExpire: 30
    });
  });

  it('stays blocked until the block expires, even after a refund', async () => {
    const blockDuration = 50;
    for (let i = 0; i <= LIMIT; i++) {
      await storage.increment(KEY, 60000, LIMIT, blockDuration, THROTTLER);
    }
    await storage.decrement(KEY);
    await storage.decrement(KEY);

    await expect(
      storage.increment(KEY, 60000, LIMIT, blockDuration, THROTTLER)
    ).resolves.toMatchObject({ isBlocked: true });

    await new Promise((resolve) => setTimeout(resolve, blockDuration * 2));
    await storage.decrement(KEY);
    await storage.decrement(KEY);

    await expect(
      storage.increment(KEY, 60000, LIMIT, blockDuration, THROTTLER)
    ).resolves.toMatchObject({ isBlocked: false });
  });
});
