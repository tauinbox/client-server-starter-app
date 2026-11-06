import { Logger } from '@nestjs/common';
import KeyvRedis, { type RedisClientConnectionType } from '@keyv/redis';
import type { Cache } from 'cache-manager';

const ERROR_LOG_THROTTLE_MS = 30_000;

/**
 * The Redis client behind the cache, or null when the cache is the in-memory
 * fallback. Nest wraps the configured adapter in a Keyv, so the adapter sits
 * at `stores[0].store`. Probed defensively because `stores` is an
 * implementation detail of the injected cache: a partial stand-in must
 * degrade, not break the caller.
 *
 * The adapter opens its connection on its first own operation, so a raw
 * command sent before that fails with "The client is closed". `getClient`
 * opens it the same way the adapter does: same timeout, no throw when the
 * connect fails. A client that stays closed makes the command of the caller
 * fail, and the caller falls back.
 */
export async function redisClientOf(
  cache: Cache
): Promise<RedisClientConnectionType | null> {
  const store: unknown = cache.stores?.[0]?.store;

  if (!(store instanceof KeyvRedis)) return null;

  try {
    return await store.getClient();
  } catch {
    return store.client;
  }
}

/**
 * Warns that a Redis-backed primitive fell back, at most once per throttle
 * window, so an outage does not write one line per request.
 */
export class ThrottledFailureLog {
  readonly #logger: Logger;
  readonly #message: string;
  #loggedAt = 0;

  /** @param message what the failure means for the caller; the error text follows it */
  constructor(logger: Logger, message: string) {
    this.#logger = logger;
    this.#message = message;
  }

  log(error: unknown): void {
    const now = Date.now();

    if (now - this.#loggedAt < ERROR_LOG_THROTTLE_MS) return;

    this.#loggedAt = now;
    this.#logger.warn(
      `${this.#message}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
