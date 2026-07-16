import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { RedisHealthIndicator } from './redis.health';

const pingMock = jest.fn();
const disconnectMock = jest.fn();
const onMock = jest.fn();
const redisCtorMock = jest.fn();

jest.mock('ioredis', () => ({
  __esModule: true,
  default: class MockRedis {
    constructor(...args: unknown[]) {
      redisCtorMock(...args);
    }
    ping = pingMock;
    disconnect = disconnectMock;
    on = onMock;
  }
}));

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let configValues: Record<string, string | undefined>;

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        HealthIndicatorService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => configValues[key]) }
        }
      ]
    }).compile();

    indicator = module.get(RedisHealthIndicator);
  });

  describe('without REDIS_URL', () => {
    it('reports up without warning outside production and opens no connection', async () => {
      configValues['ENVIRONMENT'] = 'local';

      const result = await indicator.isHealthy('redis');

      expect(result).toEqual({ redis: { status: 'up' } });
      expect(redisCtorMock).not.toHaveBeenCalled();
    });

    it('reports up with a warning in production', async () => {
      configValues['ENVIRONMENT'] = 'production';

      const result = await indicator.isHealthy('redis');

      expect(result['redis'].status).toBe('up');
      expect(result['redis']['warning']).toContain('REDIS_URL not set');
    });
  });

  describe('with REDIS_URL', () => {
    beforeEach(() => {
      configValues['REDIS_URL'] = 'redis://localhost:6379';
    });

    it('reports up when PING succeeds', async () => {
      pingMock.mockResolvedValue('PONG');

      const result = await indicator.isHealthy('redis');

      expect(result).toEqual({ redis: { status: 'up' } });
      expect(pingMock).toHaveBeenCalledTimes(1);
    });

    it('reports down when PING fails', async () => {
      pingMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const result = await indicator.isHealthy('redis');

      expect(result).toEqual({
        redis: { status: 'down', message: 'Redis ping failed' }
      });
    });

    it('reports down when PING hangs past the timeout', async () => {
      jest.useFakeTimers();
      try {
        pingMock.mockReturnValue(new Promise(() => undefined));

        const pending = indicator.isHealthy('redis');
        await jest.advanceTimersByTimeAsync(2000);

        await expect(pending).resolves.toEqual({
          redis: { status: 'down', message: 'Redis ping failed' }
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('reuses a single client across checks', async () => {
      pingMock.mockResolvedValue('PONG');

      await indicator.isHealthy('redis');
      await indicator.isHealthy('redis');

      expect(redisCtorMock).toHaveBeenCalledTimes(1);
      expect(pingMock).toHaveBeenCalledTimes(2);
    });

    it('recovers to up on a later check after a failure', async () => {
      pingMock.mockRejectedValueOnce(new Error('down'));
      pingMock.mockResolvedValueOnce('PONG');

      const first = await indicator.isHealthy('redis');
      const second = await indicator.isHealthy('redis');

      expect(first['redis'].status).toBe('down');
      expect(second['redis'].status).toBe('up');
    });

    it('registers an error listener on the client', async () => {
      pingMock.mockResolvedValue('PONG');

      await indicator.isHealthy('redis');

      expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('disconnects the client on module destroy', async () => {
      pingMock.mockResolvedValue('PONG');
      await indicator.isHealthy('redis');

      indicator.onModuleDestroy();

      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it('does nothing on module destroy when no client was created', () => {
      indicator.onModuleDestroy();

      expect(disconnectMock).not.toHaveBeenCalled();
    });
  });
});
