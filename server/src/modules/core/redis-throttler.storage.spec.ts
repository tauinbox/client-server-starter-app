import { RedisThrottlerStorage } from './redis-throttler.storage';

let redisMock: {
  disconnect: jest.Mock;
  zpopmax: jest.Mock;
  multi: jest.Mock;
  set: jest.Mock;
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
      set: jest.fn().mockResolvedValue('OK')
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
  });

  describe('decrement', () => {
    it('should call redis.zpopmax with the key and count 1', async () => {
      await storage.decrement('throttle:key');
      expect(redisMock.zpopmax).toHaveBeenCalledWith('throttle:key', 1);
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
      expect(result.timeToBlockExpire).toBeGreaterThan(0);
    });

    it('should return timeToBlockExpire=0 when not blocked and blockDuration=0', async () => {
      const result = await storage.increment('key', 60000, 10, 0, 'default');

      expect(result.timeToBlockExpire).toBe(0);
    });
  });
});
