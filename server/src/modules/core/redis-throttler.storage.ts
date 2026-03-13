import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, { lazyConnect: false });
  }

  disconnect(): void {
    this.redis.disconnect();
  }

  async decrement(key: string): Promise<void> {
    await this.redis.zpopmax(key, 1);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string
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
      timeToExpire: ttl,
      isBlocked,
      timeToBlockExpire:
        blockExpiry != null
          ? Math.max(0, blockExpiry - now)
          : isBlocked
            ? blockDuration
            : 0
    };
  }
}
