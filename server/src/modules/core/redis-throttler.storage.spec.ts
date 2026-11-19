import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler.storage';

let redisMock: {
  disconnect: jest.Mock;
  zpopmax: jest.Mock;
  multi: jest.Mock;
  set: jest.Mock;
  get: jest.Mock;
};

let multiMock: {
  zremrangebyscore: jest.Mock;
  zadd: jest.Mock;
  zcard: jest.Mock;
  pexpire: jest.Mock;
  get: jest.Mock;
  exec: jest.Mock;
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => redisMock)
}));

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    multiMock = {
      zremrangebyscore: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      pexpire: jest.fn().mockReturnThis(),
      get: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, 2],
        [null, 1],
        [null, null]
      ])
    };

    redisMock = {
      disconnect: jest.fn(),
      zpopmax: jest.fn().mockResolvedValue(null),
      multi: jest.fn().mockReturnValue(multiMock),
      set: jest.fn().mockResolvedValue('OK'),
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
      // A full Redis aborts the MULTI; a throw here answered every throttled
      // route with an internal error.
      multiMock.exec.mockRejectedValue(
        new Error('EXECABORT Transaction discarded because of previous errors.')
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
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('EXECABORT'));
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
    it('should return totalHits and isBlocked=false when under limit', async () => {
      multiMock.exec.mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, 2], // totalHits = 2
        [null, 1],
        [null, null]
      ]);

      const result = await storage.increment('key', 60000, 10, 0, 'default');

      expect(result.totalHits).toBe(2);
      expect(result.isBlocked).toBe(false);
    });

    it('should set block key and return isBlocked=true when totalHits exceeds limit', async () => {
      multiMock.exec.mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, 15], // totalHits = 15 > limit 10
        [null, 1],
        [null, null] // no existing block
      ]);

      const result = await storage.increment('key', 60000, 10, 5000, 'default');

      expect(result.totalHits).toBe(15);
      expect(result.isBlocked).toBe(true);
      expect(result.timeToExpire).toBe(60);
      expect(result.timeToBlockExpire).toBe(5);
      expect(redisMock.set).toHaveBeenCalledWith(
        'key:block',
        expect.any(String),
        'PX',
        5000
      );
    });

    it('should respect existing block key and return isBlocked=true', async () => {
      const blockExpiry = Date.now() + 10000;

      multiMock.exec.mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, 1],
        [null, 1],
        [null, blockExpiry.toString()]
      ]);

      const result = await storage.increment('key', 60000, 10, 5000, 'default');

      expect(result.isBlocked).toBe(true);
      expect(result.timeToBlockExpire).toBe(10);
    });

    it('should return timeToBlockExpire=0 when not blocked and blockDuration=0', async () => {
      const result = await storage.increment('key', 60000, 10, 0, 'default');

      expect(result.timeToBlockExpire).toBe(0);
    });
  });
});
