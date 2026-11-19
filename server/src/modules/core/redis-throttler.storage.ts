import { Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { msToSeconds } from './throttler-storage.interface';
import type { DecrementableThrottlerStorage } from './throttler-storage.interface';
import Redis from 'ioredis';
import { ThrottledFailureLog } from '../../common/utils/redis-client';

interface HitLimits {
  ttl: number;
  limit: number;
  blockDuration: number;
}

/**
 * A storage that cannot record a hit fails open: the request is not limited.
 * A full Redis under `noeviction` refuses the write of every hit, and a
 * failure that refused the request would turn that state into an outage of
 * every throttled route. The account lockout in the database and the
 * per-subject counters, which fail closed, still bound a credential guess.
 */
export class RedisThrottlerStorage
  implements DecrementableThrottlerStorage, OnModuleDestroy
{
  private readonly redis: Redis;
  private readonly failureLog = new ThrottledFailureLog(
    new Logger(RedisThrottlerStorage.name),
    'Throttler storage cannot record a hit, the request is not limited'
  );

  constructor(url: string) {
    this.redis = new Redis(url, { lazyConnect: false });
  }

  // ThrottlerModule registers this instance under the ThrottlerStorage token,
  // so Nest owns its lifecycle. Without the hook the connection outlives
  // shutdown and keeps the process alive.
  onModuleDestroy(): void {
    this.disconnect();
  }

  disconnect(): void {
    this.redis.disconnect();
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.redis.zpopmax(key, 1);
    } catch (error: unknown) {
      this.failureLog.log(error);
    }
  }

  // eslint-disable-next-line no-restricted-syntax -- ThrottlerStorage of @nestjs/throttler defines increment
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.record(key, { ttl, limit, blockDuration });
    } catch (error: unknown) {
      this.failureLog.log(error);

      return {
        totalHits: 0,
        timeToExpire: msToSeconds(ttl),
        isBlocked: false,
        timeToBlockExpire: 0
      };
    }
  }

  private async record(
    key: string,
    { ttl, limit, blockDuration }: HitLimits
  ): Promise<ThrottlerStorageRecord> {
    const now = Date.now();
    const windowStart = now - ttl;
    const blockKey = `${key}:block`;
    const entryKey = `${now}-${Math.random().toString(36).slice(2)}`;

    const results = await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', windowStart.toString())
      .zadd(key, now.toString(), entryKey)
      .zcard(key)
      .pexpire(key, ttl)
      .get(blockKey)
      .exec();

    const totalHits = (results?.[2]?.[1] as number) ?? 1;
    const rawBlock = results?.[4]?.[1] as string | null;
    const blockExpiry = rawBlock ? parseInt(rawBlock, 10) : null;

    const isBlocked =
      blockExpiry != null ? blockExpiry > now : totalHits > limit;

    if (totalHits > limit && blockExpiry == null && blockDuration > 0) {
      await this.redis.set(
        blockKey,
        (now + blockDuration).toString(),
        'PX',
        blockDuration
      );
    }

    return {
      totalHits,
      timeToExpire: msToSeconds(ttl),
      isBlocked,
      timeToBlockExpire: msToSeconds(
        blockExpiry != null
          ? Math.max(0, blockExpiry - now)
          : isBlocked
            ? blockDuration
            : 0
      )
    };
  }
}
