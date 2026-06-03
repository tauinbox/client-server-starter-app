import type { RedisOptions } from 'ioredis';

/**
 * Splits a REDIS_URL into the host/port/credentials shape BullMQ expects for a
 * queue connection. (CacheModule and the throttler storage take the raw URL, so
 * only the BullMQ-backed queue modules need this breakdown.)
 */
export function parseRedisConnection(url: string): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {})
  };
}
