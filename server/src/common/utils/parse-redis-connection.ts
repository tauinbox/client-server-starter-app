import type { RedisOptions } from 'ioredis';

/**
 * Splits a REDIS_URL into the host/port/credentials/database shape BullMQ
 * expects for a queue connection. (CacheModule and the throttler storage take
 * the raw URL, so only the BullMQ-backed queue modules need this breakdown.)
 */
export function parseRedisConnection(url: string): RedisOptions {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\/+/, '');
  const db = database === '' ? NaN : Number(database);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    // A logical database in the URL path has to reach the queues too, otherwise
    // they stay on database 0 while the cache and throttler follow the URL.
    ...(Number.isInteger(db) && db >= 0 ? { db } : {}),
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {})
  };
}
