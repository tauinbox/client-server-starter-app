import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { redisClientOf, ThrottledFailureLog } from './redis-client';

/**
 * A monotonic generation counter used to suffix per-user cache keys, so a
 * global invalidation orphans every key at once without a SCAN+DEL.
 *
 * With Redis available the counter is a raw `INCR` on its own key: atomic, so
 * simultaneous invalidations across instances cannot read the same previous
 * value and write back the same next one, and an absent key reads as 0 so there
 * is no initializing write to race over. The raw client is used rather than
 * cache-manager because Keyv stores every value inside a JSON envelope, which
 * `INCR` cannot operate on - hence the separate key, so the two representations
 * never collide.
 *
 * Without Redis (in-memory fallback, no `REDIS_URL`) a single process owns the
 * counter, so the read-modify-write below cannot lose to another instance. It
 * is also the degradation path when Redis is unreachable: a cache outage must
 * not take down flag evaluation or entitlement resolution.
 */
export class CacheVersionCounter {
  readonly #cache: Cache;
  readonly #counterKey: string;
  readonly #fallbackKey: string;
  readonly #failureLog: ThrottledFailureLog;

  /**
   * @param counterKey raw Redis key holding the integer counter
   * @param fallbackKey cache-manager key used when Redis is absent or failing
   */
  constructor(
    cache: Cache,
    counterKey: string,
    fallbackKey: string,
    logger: Logger
  ) {
    this.#cache = cache;
    this.#counterKey = counterKey;
    this.#fallbackKey = fallbackKey;
    this.#failureLog = new ThrottledFailureLog(
      logger,
      `Version counter "${counterKey}" unavailable, falling back to the cache-manager counter`
    );
  }

  async read(): Promise<number> {
    const redis = redisClientOf(this.#cache);
    if (redis) {
      try {
        const raw = await redis.get(this.#counterKey);
        // Nothing invalidated yet, so nothing to orphan: 0 is a valid suffix.
        if (raw === null) return 0;
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) return parsed;
      } catch (error: unknown) {
        this.#failureLog.log(error);
      }
    }

    const cached = await this.#cache.get<number>(this.#fallbackKey);
    if (typeof cached === 'number') return cached;
    const initial = Date.now();
    await this.#cache.set(this.#fallbackKey, initial, 0);
    return initial;
  }

  async bump(): Promise<void> {
    const redis = redisClientOf(this.#cache);
    if (redis) {
      try {
        await redis.incr(this.#counterKey);
        return;
      } catch (error: unknown) {
        this.#failureLog.log(error);
      }
    }

    // Date.now() has millisecond granularity, so two invalidations inside one
    // millisecond would re-emit the same version and leave stale per-user cache
    // keys reachable; max(prev + 1) keeps the suffix strictly fresh.
    const previous = await this.#cache.get<number>(this.#fallbackKey);
    const next = Math.max(
      Date.now(),
      (typeof previous === 'number' ? previous : 0) + 1
    );
    await this.#cache.set(this.#fallbackKey, next, 0);
  }
}
