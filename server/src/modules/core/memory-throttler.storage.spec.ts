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
});
