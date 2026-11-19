import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler.storage';

let redisMock: {
  disconnect: jest.Mock;
  zpopmax: jest.Mock;
  eval: jest.Mock;
  get: jest.Mock;
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => redisMock)
}));

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    redisMock = {
      disconnect: jest.fn(),
      zpopmax: jest.fn().mockResolvedValue(null),
      eval: jest.fn().mockResolvedValue([1, 0, 0]),
      get: jest.fn().mockResolvedValue(null)
    };

    storage = new RedisThrottlerStorage('redis://localhost:6379');
  });

  it('should be defined', () => {
    expect(storage).toBeDefined();
  });

  describe('disconnect', () => {
    it('should call redis.disconnect()', () => {
      storage.disconnect();
      expect(redisMock.disconnect).toHaveBeenCalled();
    });

    it('disconnects on module destroy so the connection cannot outlive shutdown', () => {
      storage.onModuleDestroy();
      expect(redisMock.disconnect).toHaveBeenCalledTimes(1);
    });

    // The hook only helps if Nest actually invokes it. ThrottlerModule
    // registers the instance under the ThrottlerStorage token, so shutting the
    // app down must close the connection.
    it('is disconnected by Nest when the application shuts down', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRootAsync({
            useFactory: () => ({
              throttlers: [{ ttl: 1000, limit: 5 }],
              storage
            })
          })
        ]
      }).compile();
      const app = moduleRef.createNestApplication();

      await app.init();

      expect(redisMock.disconnect).not.toHaveBeenCalled();
      await app.close();
      expect(redisMock.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('decrement', () => {
    it('should call redis.zpopmax with the key and count 1', async () => {
      await storage.decrement('throttle:key');
      expect(redisMock.zpopmax).toHaveBeenCalledWith('throttle:key', 1);
    });
  });

  describe('a Redis that refuses the write', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => {
      warn.mockRestore();
    });

    beforeEach(() => {
      // A throw here answered every throttled route with an internal error.
      redisMock.eval.mockRejectedValue(
        new Error("OOM command not allowed when used memory > 'maxmemory'.")
      );
    });

    it('counts the hits in this process and blocks above the limit', async () => {
      const first = await storage.increment('key', 60_000, 2, 5_000, 'login');

      await storage.increment('key', 60_000, 2, 5_000, 'login');
      const third = await storage.increment('key', 60_000, 2, 5_000, 'login');

      expect(first).toMatchObject({ totalHits: 1, isBlocked: false });
      expect(third).toMatchObject({
        totalHits: 3,
        isBlocked: true,
        timeToBlockExpire: 5
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('OOM'));
    });

    it('keeps a block that Redis already holds', async () => {
      redisMock.get.mockResolvedValue(String(Date.now() + 30_000));

      const result = await storage.increment('key', 60_000, 10, 5_000, 'login');

      expect(redisMock.get).toHaveBeenCalledWith('key:block');
      expect(result).toMatchObject({ isBlocked: true, timeToBlockExpire: 30 });
    });

    it('refunds a hit in this process when Redis refuses the refund', async () => {
      redisMock.zpopmax.mockRejectedValue(new Error('OOM command not allowed'));
      await storage.increment('key', 60_000, 10, 0, 'login');

      await expect(storage.decrement('key')).resolves.toBeUndefined();
      const next = await storage.increment('key', 60_000, 10, 0, 'login');

      expect(next.totalHits).toBe(1);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('increment', () => {
    it('passes the hit key, the block key and the limits to one script', async () => {
      await storage.increment('key', 60000, 10, 5000, 'default');

      const [
        [, keyCount, key, blockKey, now, windowStart, , ttl, limit, block]
      ] = redisMock.eval.mock.calls as [
        [
          string,
          number,
          string,
          string,
          number,
          number,
          string,
          number,
          number,
          number
        ]
      ];

      expect({ keyCount, key, blockKey, ttl, limit, block }).toEqual({
        keyCount: 2,
        key: 'key',
        blockKey: 'key:block',
        ttl: 60000,
        limit: 10,
        block: 5000
      });
      expect(now - windowStart).toBe(60000);
    });

    it('reports the hits of the window when under the limit', async () => {
      redisMock.eval.mockResolvedValue([2, 0, 0]);

      await expect(
        storage.increment('key', 60000, 10, 0, 'default')
      ).resolves.toEqual({
        totalHits: 2,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0
      });
    });

    it('reports a block and its time left in seconds', async () => {
      redisMock.eval.mockResolvedValue([11, 1, 9500]);

      await expect(
        storage.increment('key', 60000, 10, 10000, 'default')
      ).resolves.toEqual({
        totalHits: 11,
        timeToExpire: 60,
        isBlocked: true,
        timeToBlockExpire: 10
      });
    });
  });
});
