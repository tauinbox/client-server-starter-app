import type { OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { msToSeconds } from './throttler-storage.interface';
import type { DecrementableThrottlerStorage } from './throttler-storage.interface';

const SWEEP_INTERVAL_MS = 60000;

interface Entry {
  hits: number[];
  expiresAt: number;
  blockExpiresAt: number | null;
}

/**
 * The single-instance storage, used whenever no Redis URL is configured. It
 * uses the sliding window of `RedisThrottlerStorage`: one timestamp for each
 * hit, so `decrement` removes exactly the hit that it refunds.
 */
export class MemoryThrottlerStorage
  implements DecrementableThrottlerStorage, OnApplicationShutdown
{
  private readonly entries = new Map<string, Entry>();
  private sweepTimer: NodeJS.Timeout | undefined;

  increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    const now = Date.now();
    this.ensureSweep();

    const entry = this.entries.get(key) ?? {
      hits: [],
      expiresAt: 0,
      blockExpiresAt: null
    };
    entry.hits = entry.hits.filter((at) => at > now - ttl);
    entry.hits.push(now);
    entry.expiresAt = now + ttl;
    if (entry.blockExpiresAt !== null && entry.blockExpiresAt <= now) {
      entry.blockExpiresAt = null;
    }
    this.entries.set(key, entry);

    const totalHits = entry.hits.length;
    const blockExpiry = entry.blockExpiresAt;
    const isBlocked =
      blockExpiry !== null ? blockExpiry > now : totalHits > limit;

    if (totalHits > limit && blockExpiry === null && blockDuration > 0) {
      entry.blockExpiresAt = now + blockDuration;
    }

    const blockRemaining =
      blockExpiry !== null ? blockExpiry - now : isBlocked ? blockDuration : 0;

    return Promise.resolve({
      totalHits,
      timeToExpire: msToSeconds(ttl),
      isBlocked,
      timeToBlockExpire: msToSeconds(blockRemaining)
    });
  }

  decrement(key: string): Promise<void> {
    this.entries.get(key)?.hits.pop();
    return Promise.resolve();
  }

  onApplicationShutdown(): void {
    clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    this.entries.clear();
  }

  private ensureSweep(): void {
    if (this.sweepTimer) {
      return;
    }
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  private sweep(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now && (entry.blockExpiresAt ?? 0) <= now) {
        this.entries.delete(key);
      }
    }
  }
}
