import { Logger } from '@nestjs/common';
import KeyvRedis, { type RedisClientConnectionType } from '@keyv/redis';
import type { Cache } from 'cache-manager';

const ERROR_LOG_THROTTLE_MS = 30_000;

/** What a caller needs to decide whether the subject is barred, and for how long. */
export interface AttemptWindow {
  /** Failures recorded in the open window. 0 when no window is open. */
  count: number;
  /** Milliseconds left in the open window. 0 when no window is open. */
  remainingMs: number;
}

const NO_WINDOW: AttemptWindow = { count: 0, remainingMs: 0 };

/**
 * A fixed-window failure counter for a subject that has no counter column of
 * its own. It bars the subject rather than the caller, so a distributed
 * attacker gains nothing by changing address, which is what a per-IP throttle
 * alone cannot do.
 *
 * With Redis available the count is a raw `INCR`: atomic, so a burst fired at
 * several instances at once cannot read the same previous value and write back
 * the same next one. The expiry is written first, by a `SET NX PX` that also
 * creates the key, because an `INCR` that lands before its `PEXPIRE` fails
 * would leave a counter with no expiry - that is a subject barred for ever.
 * The raw client is used rather than cache-manager because Keyv stores every
 * value inside a JSON envelope, which `INCR` cannot operate on, and because
 * Keyv exposes no conditional write.
 *
 * Without Redis (in-memory fallback, no `REDIS_URL`) the window is held in this
 * process. The map is read and written synchronously, so a burst cannot
 * interleave two awaits and lose an increment. That fallback is per instance: a
 * deployment that runs several instances without Redis counts on one of them
 * only, the same limit the single-use ledger carries.
 *
 * A counter that cannot be reached fails open. It hardens a gate that a caller
 * only reaches after passing an earlier one, so a cache outage must not take
 * that gate down with it.
 */
export class FailedAttemptCounter {
  readonly #cache: Cache;
  readonly #keyPrefix: string;
  readonly #logger: Logger;
  readonly #local = new Map<string, { count: number; expiresAt: number }>();
  #errorLoggedAt = 0;

  /**
   * @param keyPrefix namespace for the counter keys, e.g. `mfa:challenge:`
   */
  constructor(cache: Cache, keyPrefix: string, logger: Logger) {
    this.#cache = cache;
    this.#keyPrefix = keyPrefix;
    this.#logger = logger;
  }

  /**
   * Counts one failure against `id` and reports the window after it.
   *
   * @param windowMs how long the window stays open. It is set when the window
   * opens and never extended, so a barred subject cannot be held past it by
   * further attempts.
   */
  async record(id: string, windowMs: number): Promise<AttemptWindow> {
    const key = this.#key(id);
    const redis = this.#redisClient();

    if (redis) {
      try {
        await redis.set(key, '0', {
          condition: 'NX',
          expiration: { type: 'PX', value: windowMs }
        });
        const count = await redis.incr(key);
        return { count, remainingMs: await this.#remainingMs(redis, key) };
      } catch (error: unknown) {
        this.#logFailure(error);
        return NO_WINDOW;
      }
    }

    const now = Date.now();
    this.#pruneLocal(now);
    const open = this.#local.get(key);
    const entry =
      open && open.expiresAt > now
        ? open
        : { count: 0, expiresAt: now + windowMs };
    entry.count += 1;
    this.#local.set(key, entry);
    return { count: entry.count, remainingMs: entry.expiresAt - now };
  }

  /** Reports the open window for `id` without counting anything. */
  async read(id: string): Promise<AttemptWindow> {
    const key = this.#key(id);
    const redis = this.#redisClient();

    if (redis) {
      try {
        const raw = await redis.get(key);
        const count = raw === null ? 0 : Number(raw);
        if (!Number.isFinite(count) || count <= 0) return NO_WINDOW;
        return { count, remainingMs: await this.#remainingMs(redis, key) };
      } catch (error: unknown) {
        this.#logFailure(error);
        return NO_WINDOW;
      }
    }

    const now = Date.now();
    const open = this.#local.get(key);
    if (!open || open.expiresAt <= now) return NO_WINDOW;
    return { count: open.count, remainingMs: open.expiresAt - now };
  }

  /** Closes the window for `id`, which a caller does once the subject passes. */
  async clear(id: string): Promise<void> {
    const key = this.#key(id);
    const redis = this.#redisClient();

    if (redis) {
      try {
        await redis.del(key);
      } catch (error: unknown) {
        this.#logFailure(error);
      }
      return;
    }

    this.#local.delete(key);
  }

  #key(id: string): string {
    return `${this.#keyPrefix}${id}`;
  }

  /**
   * `PTTL` answers -1 for a key with no expiry and -2 for a key that is gone.
   * Neither is a window, so both read as closed.
   */
  async #remainingMs(
    redis: RedisClientConnectionType,
    key: string
  ): Promise<number> {
    const ttl = await redis.pTTL(key);
    return ttl > 0 ? Number(ttl) : 0;
  }

  #pruneLocal(now: number): void {
    for (const [key, entry] of this.#local) {
      if (entry.expiresAt <= now) this.#local.delete(key);
    }
  }

  /**
   * The Redis client behind the cache, or null when the cache is the in-memory
   * fallback. Nest wraps the configured adapter in a Keyv, so the adapter sits
   * at `stores[0].store`. Probed defensively because `stores` is an
   * implementation detail of the injected cache: a partial stand-in must
   * degrade, not break the caller.
   */
  #redisClient(): RedisClientConnectionType | null {
    const store: unknown = this.#cache.stores?.[0]?.store;
    return store instanceof KeyvRedis ? store.client : null;
  }

  #logFailure(error: unknown): void {
    const now = Date.now();
    if (now - this.#errorLoggedAt < ERROR_LOG_THROTTLE_MS) return;
    this.#errorLoggedAt = now;
    this.#logger.warn(
      `Attempt counter "${this.#keyPrefix}" unavailable, the per-subject limit is not enforced: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
