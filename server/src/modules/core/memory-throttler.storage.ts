import { ThrottlerStorageService } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { DecrementableThrottlerStorage } from './throttler-storage.interface';

/**
 * The single-instance storage, used whenever no Redis URL is configured.
 * `ThrottlerStorageService` covers the counting; this adds the `decrement`
 * that `LoginThrottlerGuard` needs to refund a successful login.
 */
export class MemoryThrottlerStorage
  extends ThrottlerStorageService
  implements DecrementableThrottlerStorage
{
  override async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    // Every hit schedules a timer that decrements the same counter once the
    // ttl elapses. A hit already refunded by `decrement` still has its timer
    // pending, so the counter can fall below zero and hand out extra attempts
    // in the next window. Clamp before the new hit is counted.
    const record = this.storage.get(key);
    const hits = record?.totalHits.get(throttlerName);
    if (record && hits !== undefined && hits < 0) {
      record.totalHits.set(throttlerName, 0);
    }

    return super.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  decrement(key: string): Promise<void> {
    const record = this.storage.get(key);
    if (record) {
      // `ThrottlerGuard.generateKey` hashes the throttler name into the key,
      // so a record carries exactly one entry.
      for (const [throttlerName, hits] of record.totalHits) {
        record.totalHits.set(throttlerName, Math.max(0, hits - 1));
      }
    }

    return Promise.resolve();
  }
}
