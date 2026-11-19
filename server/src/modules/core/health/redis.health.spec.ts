import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { RedisHealthIndicator } from './redis.health';
import {
  DEPENDENCY_HEALTH_REF,
  DependencyHealthRef,
  createDependencyHealthRef
} from '../metrics/dependency-up.gauge';
import {
  REDIS_MEMORY_REF,
  RedisMemoryRef,
  createRedisMemoryRef
} from '../metrics/redis-memory.gauge';

const pingMock = jest.fn();
const infoMock = jest.fn();
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
    info = infoMock;
    disconnect = disconnectMock;
    on = onMock;
  }
}));

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let configValues: Record<string, string | undefined>;
  let dependencyHealth: DependencyHealthRef;
  let redisMemory: RedisMemoryRef;

  beforeEach(async () => {
    jest.clearAllMocks();
    infoMock.mockResolvedValue('used_memory:100\r\nmaxmemory:0\r\n');
    configValues = {};
    dependencyHealth = createDependencyHealthRef();
    redisMemory = createRedisMemoryRef();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        HealthIndicatorService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => configValues[key]) }
        },
        { provide: DEPENDENCY_HEALTH_REF, useValue: dependencyHealth },
        { provide: REDIS_MEMORY_REF, useValue: redisMemory }
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
      expect(dependencyHealth.statuses.get('redis')).toBe(true);
    });

    it('reports up with a warning in production', async () => {
      configValues['ENVIRONMENT'] = 'production';

      const result = await indicator.isHealthy('redis');

      expect(result['redis'].status).toBe('up');
      expect(result['redis']['warning']).toContain('REDIS_URL not set');
    });

    it('marks the dependency degraded in production so the warning is alertable', async () => {
      configValues['ENVIRONMENT'] = 'production';

      await indicator.isHealthy('redis');

      expect(dependencyHealth.statuses.get('redis')).toBe(false);
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
      expect(dependencyHealth.statuses.get('redis')).toBe(true);
    });

    it('records the memory ratio of a Redis with maxmemory', async () => {
      pingMock.mockResolvedValue('PONG');
      infoMock.mockResolvedValue(
        '# Memory\r\nused_memory:75\r\nused_memory_human:75B\r\nmaxmemory:100\r\n'
      );

      await indicator.isHealthy('redis');

      expect(infoMock).toHaveBeenCalledWith('memory');
      expect(redisMemory.ratio).toBe(0.75);
    });

    it('records no memory ratio for a Redis with no maxmemory', async () => {
      pingMock.mockResolvedValue('PONG');

      await indicator.isHealthy('redis');

      expect(redisMemory.ratio).toBeNull();
    });

    it('reports down when PING fails', async () => {
      pingMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const result = await indicator.isHealthy('redis');

      expect(result).toEqual({
        redis: { status: 'down', message: 'Redis ping failed' }
      });
      expect(dependencyHealth.statuses.get('redis')).toBe(false);
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
