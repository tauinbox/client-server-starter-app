import { Logger } from '@nestjs/common';
import type { CacheModuleOptions } from '@nestjs/cache-manager';
import KeyvRedis from '@keyv/redis';

// Without a bound, a cache call against an unreachable Redis never settles and
// the request hangs forever instead of degrading to an uncached read.
const CONNECTION_TIMEOUT_MS = 1000;

// A disconnected client re-emits on every retry - tens of events per second.
const ERROR_LOG_THROTTLE_MS = 30_000;

export function createRedisCacheStore(url: string): KeyvRedis<unknown> {
  const store = new KeyvRedis<unknown>(url, {
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    throwOnConnectError: false
  });

  const logger = new Logger('RedisCacheStore');
  let lastLoggedAt = 0;
  store.on('error', (error: unknown) => {
    const now = Date.now();
    if (now - lastLoggedAt < ERROR_LOG_THROTTLE_MS) return;
    lastLoggedAt = now;
    logger.warn(
      `Redis cache unreachable, serving uncached reads: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });

  return store;
}

/**
 * Builds the cache options. The key MUST be `stores` (plural): a singular
 * `store` still type-checks, because CacheModuleOptions widens to
 * Record<string, any>, but the provider factory ignores it and silently falls
 * back to the in-memory cache - which reads and writes correctly, so the loss
 * of Redis stays invisible until two instances disagree.
 */
export function buildCacheOptions(
  redisUrl: string | undefined
): CacheModuleOptions {
  if (!redisUrl) {
    return {};
  }
  return { stores: [createRedisCacheStore(redisUrl)] };
}
