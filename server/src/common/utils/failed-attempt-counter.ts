import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { redisClientOf, ThrottledFailureLog } from './redis-client';

/** What a caller needs to decide whether the subject is barred, and for how long. */
export interface AttemptWindow {
  /** Failures recorded in the open window. 0 when no window is open. */
  count: number;
  /** Milliseconds left in the open window. 0 when no window is open. */
  remainingMs: number;
}

const NO_WINDOW: AttemptWindow = { count: 0, remainingMs: 0 };

// Returns { count, pttl }. The expiry is set only on a key that has none, so
// the window is never extended.
const RECORD_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('PTTL', KEYS[1]) }
`;

/**
 * A fixed-window failure counter for a subject that has no counter column of
 * its own. It bars the subject rather than the caller, so a distributed
 * attacker gains nothing by changing address, which is what a per-IP throttle
 * alone cannot do.
 *
 * With Redis available the count is an `INCR` inside one Lua script that also
 * sets the expiry when the key has none. Redis runs a script atomically, so a
 * burst fired at several instances at once cannot lose an increment, and the
 * key cannot expire between the increment and the expiry. Separate commands
 * leave that gap: a key that expires after a `SET NX` and before the `INCR` is
 * created again by the `INCR` with no expiry - that is a subject barred for
 * ever. The script also repairs a key that already has no expiry. The raw
 * client is used rather than cache-manager because Keyv stores every value
 * inside a JSON envelope, which `INCR` cannot operate on.
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
  readonly #failureLog: ThrottledFailureLog;
  readonly #local = new Map<string, { count: number; expiresAt: number }>();

  /**
   * @param keyPrefix namespace for the counter keys, e.g. `mfa:challenge:`
   */
  constructor(cache: Cache, keyPrefix: string, logger: Logger) {
    this.#cache = cache;
    this.#keyPrefix = keyPrefix;
    this.#failureLog = new ThrottledFailureLog(
      logger,
      `Attempt counter "${keyPrefix}" unavailable, the per-subject limit is not enforced`
    );
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
    const redis = redisClientOf(this.#cache);

    if (redis) {
      try {
        const [count, ttl] = (await redis.eval(RECORD_SCRIPT, {
          keys: [key],
          arguments: [String(windowMs)]
        })) as [number, number];
        return { count, remainingMs: ttl > 0 ? ttl : 0 };
      } catch (error: unknown) {
        this.#failureLog.log(error);
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

  /** Closes the window for `id`, which a caller does once the subject passes. */
  async clear(id: string): Promise<void> {
    const key = this.#key(id);
    const redis = redisClientOf(this.#cache);

    if (redis) {
      try {
        await redis.del(key);
      } catch (error: unknown) {
        this.#failureLog.log(error);
      }
      return;
    }

    this.#local.delete(key);
  }

  #key(id: string): string {
    return `${this.#keyPrefix}${id}`;
  }

  #pruneLocal(now: number): void {
    for (const [key, entry] of this.#local) {
      if (entry.expiresAt <= now) this.#local.delete(key);
    }
  }
}
