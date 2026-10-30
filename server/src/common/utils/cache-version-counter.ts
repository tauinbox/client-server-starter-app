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
 * not take down entitlement resolution.
 *
 * A `scope` (a user id) selects one counter of a family: both keys get the
 * scope as a suffix. A reader reads the version before its query and writes
 * under it, so a read that started before an invalidation writes a key that
 * nobody reads again. A delete of the key cannot give this: the late write
 * puts the old value back.
 */
export class CacheVersionCounter {
  readonly #cache: Cache;
  readonly #counterKey: string;
  readonly #fallbackKey: string;
  readonly #failureLog: ThrottledFailureLog;
  readonly #fallbackReads = new Map<string, Promise<number>>();

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

  async read(scope?: string): Promise<number> {
    const counterKey = this.#scoped(this.#counterKey, scope);
    const fallbackKey = this.#scoped(this.#fallbackKey, scope);
    const redis = redisClientOf(this.#cache);
    if (redis) {
      try {
        const raw = await redis.get(counterKey);
        // Nothing invalidated yet, so nothing to orphan: 0 is a valid suffix.
        if (raw === null) return 0;
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) return parsed;
      } catch (error: unknown) {
        this.#failureLog.log(error);
      }
    }

    return this.#readFallback(fallbackKey);
  }

  /**
   * Concurrent reads of an empty key share one read and one initial value.
   * Each would else take its own `Date.now()`: two loads that should join get
   * two versions, and the first caller holds a version that nobody reads again.
   */
  #readFallback(fallbackKey: string): Promise<number> {
    const pending = this.#fallbackReads.get(fallbackKey);
    if (pending) return pending;
    const read = (async () => {
      const cached = await this.#cache.get<number>(fallbackKey);
      if (typeof cached === 'number') return cached;
      const initial = Date.now();
      await this.#cache.set(fallbackKey, initial, 0);
      return initial;
    })().finally(() => this.#fallbackReads.delete(fallbackKey));
    this.#fallbackReads.set(fallbackKey, read);
    return read;
  }

  async bump(scope?: string): Promise<void> {
    const counterKey = this.#scoped(this.#counterKey, scope);
    const fallbackKey = this.#scoped(this.#fallbackKey, scope);
    const redis = redisClientOf(this.#cache);
    if (redis) {
      try {
        await redis.incr(counterKey);
        return;
      } catch (error: unknown) {
        this.#failureLog.log(error);
      }
    }

    // Date.now() has millisecond granularity, so two invalidations inside one
    // millisecond would re-emit the same version and leave stale per-user cache
    // keys reachable; max(prev + 1) keeps the suffix strictly fresh.
    const previous = await this.#cache.get<number>(fallbackKey);
    const next = Math.max(
      Date.now(),
      (typeof previous === 'number' ? previous : 0) + 1
    );
    await this.#cache.set(fallbackKey, next, 0);
  }

  #scoped(key: string, scope: string | undefined): string {
    return scope === undefined ? key : `${key}:${scope}`;
  }
}
