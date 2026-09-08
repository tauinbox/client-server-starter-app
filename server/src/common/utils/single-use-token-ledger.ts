import { Logger } from '@nestjs/common';
import KeyvRedis, { type RedisClientConnectionType } from '@keyv/redis';
import type { Cache } from 'cache-manager';

const ERROR_LOG_THROTTLE_MS = 30_000;

/**
 * Records that a short-lived bearer credential was spent, so a second
 * presentation of the same value is refused.
 *
 * With Redis available the claim is a single `SET NX PX`: the reply says
 * whether this caller won the key, so two simultaneous presentations cannot
 * both read "unspent" and both proceed. A read-then-write through cache-manager
 * loses exactly that race, and the race is the one an attacker replaying a
 * captured value fires on purpose. The raw client is used rather than
 * cache-manager because Keyv exposes no conditional write - the same reason the
 * version counter reaches for the raw client.
 *
 * Without Redis (in-memory fallback, no `REDIS_URL`) a single process owns the
 * ledger. The read there still runs before the write, so the claims in flight
 * are reserved synchronously as well: Node runs each claim up to its first
 * await, which closes the window the two awaits would otherwise open. That
 * fallback is per instance: a deployment that runs several instances without
 * Redis records the claim on one of them only.
 *
 * A ledger that cannot be reached fails open. It hardens credentials that are
 * already signed, bounded to seconds, and cleared from the browser on use, so a
 * cache outage must not take sign-in down with it.
 */
export class SingleUseTokenLedger {
  readonly #cache: Cache;
  readonly #keyPrefix: string;
  readonly #logger: Logger;
  readonly #inFlight = new Set<string>();
  #errorLoggedAt = 0;

  /**
   * @param keyPrefix namespace for the claim keys, e.g. `oauth-data:spent:`
   */
  constructor(cache: Cache, keyPrefix: string, logger: Logger) {
    this.#cache = cache;
    this.#keyPrefix = keyPrefix;
    this.#logger = logger;
  }

  /**
   * Claims `id` for the caller. Returns true when this call spent it, and false
   * when it was already spent.
   *
   * @param ttlMs how long the claim is kept. The token expiry refuses anything
   * older, so the maximum age of the token is enough.
   */
  async claim(id: string, ttlMs: number): Promise<boolean> {
    const key = `${this.#keyPrefix}${id}`;
    const redis = this.#redisClient();

    if (redis) {
      try {
        const reply = await redis.set(key, '1', {
          condition: 'NX',
          expiration: { type: 'PX', value: ttlMs }
        });
        return reply !== null;
      } catch (error: unknown) {
        this.#logFailure(error);
        return true;
      }
    }

    if (this.#inFlight.has(key)) return false;
    this.#inFlight.add(key);
    try {
      if (await this.#cache.get(key)) return false;
      await this.#cache.set(key, true, ttlMs);
      return true;
    } catch (error: unknown) {
      this.#logFailure(error);
      return true;
    } finally {
      // The cache holds the claim from here on, so the reservation is only
      // needed for the two awaits above.
      this.#inFlight.delete(key);
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
      `Single-use ledger "${this.#keyPrefix}" unavailable, a replay inside the token lifetime is not refused: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
