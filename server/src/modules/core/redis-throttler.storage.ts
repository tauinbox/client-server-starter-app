import { Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { msToSeconds } from './throttler-storage.interface';
import type { DecrementableThrottlerStorage } from './throttler-storage.interface';
import Redis from 'ioredis';
import { ThrottledFailureLog } from '../../common/utils/redis-client';
import { MemoryThrottlerStorage } from './memory-throttler.storage';

interface HitLimits {
  ttl: number;
  limit: number;
  blockDuration: number;
}

// A blocked call records no hit and the set keeps limit + 1 hits. Without the
// shebang, Redis above maxmemory lets every write through after a first write
// that frees memory (ZREMRANGEBYSCORE).
const RECORD_SCRIPT = `#!lua
local now = tonumber(ARGV[1])
local block = redis.call('GET', KEYS[2])
if block and tonumber(block) > now then
  return { redis.call('ZCARD', KEYS[1]), 1, tonumber(block) - now }
end
local limit = tonumber(ARGV[5])
local blockDuration = tonumber(ARGV[6])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -(limit + 2))
local total = redis.call('ZCARD', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
if total <= limit then
  return { total, 0, 0 }
end
if blockDuration > 0 then
  redis.call('SET', KEYS[2], ARGV[7], 'PX', blockDuration)
end
return { total, 1, blockDuration }
`;

/**
 * A storage that cannot record a hit in Redis keeps limiting in this process.
 * A full Redis under `noeviction` refuses the write of every hit; a throw
 * would turn that state into an outage of every throttled route, and no limit
 * at all would hand an attacker who filled Redis an unthrottled API. So a
 * block that Redis already holds is still read (a read is not refused), and
 * the hit is counted in a `MemoryThrottlerStorage`: the limit then applies to
 * each instance, not to the whole pool.
 */
export class RedisThrottlerStorage
  implements DecrementableThrottlerStorage, OnModuleDestroy
{
  private readonly redis: Redis;
  private readonly fallback = new MemoryThrottlerStorage();
  private readonly failureLog = new ThrottledFailureLog(
    new Logger(RedisThrottlerStorage.name),
    'Throttler storage cannot record a hit in Redis, the limit applies to this instance only'
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
    this.fallback.onApplicationShutdown();
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.redis.zpopmax(key, 1);
    } catch (error: unknown) {
      this.failureLog.log(error);
      await this.fallback.decrement(key);
    }
  }

  // eslint-disable-next-line no-restricted-syntax -- ThrottlerStorage of @nestjs/throttler defines increment
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.record(key, { ttl, limit, blockDuration });
    } catch (error: unknown) {
      this.failureLog.log(error);

      return (
        (await this.heldBlock(key, ttl)) ??
        this.fallback.increment(key, ttl, limit, blockDuration, throttlerName)
      );
    }
  }

  /** The block that Redis still holds for `key`, or null when it holds none or cannot be read. */
  private async heldBlock(
    key: string,
    ttl: number
  ): Promise<ThrottlerStorageRecord | null> {
    try {
      const raw = await this.redis.get(`${key}:block`);
      const remaining = raw ? parseInt(raw, 10) - Date.now() : 0;

      return remaining > 0
        ? {
            totalHits: 0,
            timeToExpire: msToSeconds(ttl),
            isBlocked: true,
            timeToBlockExpire: msToSeconds(remaining)
          }
        : null;
    } catch {
      return null;
    }
  }

  private async record(
    key: string,
    { ttl, limit, blockDuration }: HitLimits
  ): Promise<ThrottlerStorageRecord> {
    const now = Date.now();
    const entryKey = `${now}-${Math.random().toString(36).slice(2)}`;

    const [totalHits, blocked, blockRemaining] = (await this.redis.eval(
      RECORD_SCRIPT,
      2,
      key,
      `${key}:block`,
      now,
      now - ttl,
      entryKey,
      ttl,
      limit,
      blockDuration,
      now + blockDuration
    )) as [number, number, number];

    return {
      totalHits,
      timeToExpire: msToSeconds(ttl),
      isBlocked: blocked === 1,
      timeToBlockExpire: msToSeconds(blockRemaining)
    };
  }
}
