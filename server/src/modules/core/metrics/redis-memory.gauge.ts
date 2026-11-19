import { Gauge, register } from 'prom-client';

export const REDIS_MEMORY_METRIC_NAME = 'redis_memory_used_ratio';

export const REDIS_MEMORY_REF = Symbol('REDIS_MEMORY_REF');

export interface RedisMemoryRef {
  // `used_memory / maxmemory` from the last readiness probe. Null until the
  // first probe reads it, and while Redis has no `maxmemory`, so the series
  // appears only when the ratio has a meaning.
  ratio: number | null;
}

export function createRedisMemoryRef(): RedisMemoryRef {
  return { ratio: null };
}

/**
 * Reads the ratio from the `INFO memory` text of Redis, or null when the text
 * has no `maxmemory` above 0.
 */
export function redisMemoryRatio(info: string): number | null {
  const used = Number(/^used_memory:(\d+)/m.exec(info)?.[1]);
  const max = Number(/^maxmemory:(\d+)/m.exec(info)?.[1]);

  return Number.isFinite(used) && max > 0 ? used / max : null;
}

export function createRedisMemoryGauge(ref: RedisMemoryRef): Gauge<string> {
  // Re-use the existing metric if already registered (multiple module
  // initializations in the same process during E2E tests or hot-reload).
  const existing = register.getSingleMetric(REDIS_MEMORY_METRIC_NAME);

  if (existing) {
    return existing as Gauge<string>;
  }

  return new Gauge<string>({
    name: REDIS_MEMORY_METRIC_NAME,
    help: 'Redis used_memory divided by maxmemory, as observed by the readiness probe. At 1 Redis refuses writes (noeviction).',
    // A gauge with no label always emits a default 0; with a label the series
    // is absent until a value is set.
    labelNames: ['dependency'],
    collect() {
      this.reset();

      if (ref.ratio !== null) {
        this.set({ dependency: 'redis' }, ref.ratio);
      }
    }
  });
}
