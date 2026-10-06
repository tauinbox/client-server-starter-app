import type { ThrottlerStorage } from '@nestjs/throttler';

/**
 * The storage contract this application needs. `LoginThrottlerGuard` refunds
 * the increment of a successful login, which the library's own
 * `ThrottlerStorage` cannot express, so every storage installed here must
 * implement it - a structural optional call would turn a missing method into
 * silence instead of a compile error.
 */
export interface DecrementableThrottlerStorage extends ThrottlerStorage {
  decrement(key: string): Promise<void>;
}

/**
 * `ThrottlerGuard` writes `timeToExpire` and `timeToBlockExpire` unchanged into
 * the `X-RateLimit-Reset` and `Retry-After` headers, which count seconds.
 */
export function msToSeconds(ms: number): number {
  return Math.ceil(ms / 1000);
}
