import { Logger } from '@nestjs/common';
import KeyvRedis from '@keyv/redis';
import type { Cache } from 'cache-manager';
import { createMockCache } from '../testing/cache.mock';
import { CacheVersionCounter } from './cache-version-counter';

const OOM = new Error(
  "OOM command not allowed when used memory > 'maxmemory'."
);

describe('CacheVersionCounter without Redis', () => {
  afterEach(() => jest.restoreAllMocks());

  function counter(): CacheVersionCounter<string | void> {
    return new CacheVersionCounter<string | void>(createMockCache(), {
      counterKey: 'test:counter',
      fallbackKey: 'test:version',
      logger: new Logger('test'),
      entryKeys: () => []
    });
  }

  it('gives concurrent first reads one version across a millisecond boundary', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1001);
    const versions = counter();

    const reads = await Promise.all([versions.read(), versions.read()]);

    expect(reads).toEqual([1000, 1000]);
    expect(await versions.read()).toBe(1000);
  });

  it('a read after a bump sees the new version', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const versions = counter();

    await versions.read();

    await versions.bump();

    expect(await versions.read()).toBe(1001);
  });

  it('keeps the counters of two scopes apart', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const versions = counter();

    const [a, b] = await Promise.all([
      versions.read('user-a'),
      versions.read('user-b')
    ]);

    expect([a, b]).toEqual([1000, 2000]);
  });
});

describe('CacheVersionCounter with Redis', () => {
  let redis: {
    isOpen: boolean;
    on: jest.Mock;
    get: jest.Mock;
    incr: jest.Mock;
    del: jest.Mock;
  };
  let logger: Logger;
  let cache: Cache;

  beforeEach(() => {
    redis = {
      isOpen: true,
      on: jest.fn(),
      get: jest.fn().mockResolvedValue('3'),
      incr: jest.fn().mockResolvedValue(4),
      del: jest.fn().mockResolvedValue(2)
    };
    const adapter = new KeyvRedis('redis://localhost:6379');

    // @ts-expect-error stand-in for the node-redis client: only isOpen, on, get, incr and del are exercised
    adapter.client = redis;
    cache = createMockCache();
    Object.defineProperty(cache, 'stores', { value: [{ store: adapter }] });
    logger = new Logger('test');
    jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  function counter(): CacheVersionCounter<string> {
    return new CacheVersionCounter<string>(cache, {
      counterKey: 'test:counter',
      fallbackKey: 'test:version',
      logger,
      entryKeys: (version, userId) => [
        `a:${userId}:v${version}`,
        `b:${userId}:v${version}`
      ]
    });
  }

  it('bumps with one INCR and deletes nothing', async () => {
    await counter().bump('u1');

    expect(redis.incr).toHaveBeenCalledWith('test:counter:u1');
    expect(redis.del).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('deletes the entries of the current version when Redis refuses the INCR', async () => {
    redis.incr.mockRejectedValue(OOM);

    await counter().bump('u1');

    expect(redis.get).toHaveBeenCalledWith('test:counter:u1');
    expect(redis.del).toHaveBeenCalledWith(['a:u1:v3', 'b:u1:v3']);
    expect(cache.set).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('deletes the entries of version 0 when the counter was never written', async () => {
    redis.incr.mockRejectedValue(OOM);
    redis.get.mockResolvedValue(null);

    await counter().bump('u1');

    expect(redis.del).toHaveBeenCalledWith(['a:u1:v0', 'b:u1:v0']);
  });

  it('logs an error when the delete fails too', async () => {
    redis.incr.mockRejectedValue(OOM);
    redis.del.mockRejectedValue(new Error('ECONNRESET'));

    await expect(counter().bump('u1')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      'Version counter "test:counter:u1" cannot invalidate: the cached entries stay until their TTL',
      expect.objectContaining({ message: 'ECONNRESET' })
    );
  });
});
