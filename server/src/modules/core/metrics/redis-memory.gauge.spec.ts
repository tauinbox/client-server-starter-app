import { register } from 'prom-client';
import {
  REDIS_MEMORY_METRIC_NAME,
  createRedisMemoryGauge,
  createRedisMemoryRef,
  redisMemoryRatio
} from './redis-memory.gauge';

describe('redis memory gauge', () => {
  afterEach(() => {
    register.removeSingleMetric(REDIS_MEMORY_METRIC_NAME);
  });

  describe('redisMemoryRatio', () => {
    it('divides used_memory by maxmemory', () => {
      expect(
        redisMemoryRatio(
          '# Memory\r\nused_memory:60\r\nused_memory_human:60B\r\nmaxmemory:80\r\nmaxmemory_human:80B\r\n'
        )
      ).toBe(0.75);
    });

    it('gives null for a Redis with no maxmemory', () => {
      expect(redisMemoryRatio('used_memory:60\r\nmaxmemory:0\r\n')).toBeNull();
    });

    it('gives null for a text with no memory fields', () => {
      expect(redisMemoryRatio('# Server\r\n')).toBeNull();
    });
  });

  describe('createRedisMemoryGauge', () => {
    it('emits nothing before the first readiness probe', async () => {
      const metric = await createRedisMemoryGauge(createRedisMemoryRef()).get();

      expect(metric.values).toHaveLength(0);
    });

    it('emits the last ratio, and drops it when the ratio goes back to null', async () => {
      const ref = createRedisMemoryRef();

      createRedisMemoryGauge(ref);
      ref.ratio = 0.85;
      const full = await register.metrics();

      ref.ratio = null;
      const unknown = await register.metrics();

      expect(full).toContain(
        'redis_memory_used_ratio{dependency="redis"} 0.85'
      );
      expect(unknown).not.toMatch(/^redis_memory_used_ratio/m);
    });

    it('reuses an already-registered metric', () => {
      const first = createRedisMemoryGauge(createRedisMemoryRef());
      const second = createRedisMemoryGauge(createRedisMemoryRef());

      expect(second).toBe(first);
    });
  });
});
