import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { Controller, Get, INestApplication, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import type { Cache } from 'cache-manager';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import request from 'supertest';
import type { Server } from 'http';
import { buildCacheOptions } from '../src/modules/core/redis-cache.store';
import { buildThrottlerOptions } from '../src/modules/core/throttler-options';
import { LoginThrottlerGuard } from '../src/modules/core/login-throttler.guard';
import { SingleUseTokenLedger } from '../src/common/utils/single-use-token-ledger';
import { FailedAttemptCounter } from '../src/common/utils/failed-attempt-counter';
import { parseRedisConnection } from '../src/common/utils/parse-redis-connection';
import { RenewalProcessor } from '../src/modules/billing/renewals/renewal.processor';
import type { RenewalService } from '../src/modules/billing/renewals/renewal.service';
import type { RenewalNoticeService } from '../src/modules/billing/renewals/renewal-notice.service';
import { BILLING_RENEWAL_QUEUE } from '../src/modules/billing/renewals/renewal-queue.constants';

const { REDIS_FULL_URL } = process.env;
// Large values fill Redis fast. The query buffer of a large write counts as
// used memory only while the write runs, so small writes still fit after the
// first refusal; the small values close that gap.
const FILL_VALUES = ['x'.repeat(64 * 1024), 'x'.repeat(64)];
const MAX_FILL_WRITES = 5000;

// Production Redis runs with maxmemory and noeviction, so a full Redis refuses
// every write. This suite fills a small Redis to that state and checks the
// answer of each Redis user. REDIS_FULL_URL names a Redis that the suite may
// flush (server/docker-compose.yml `redis-full`, CI starts the same one).
const runWithRedis = REDIS_FULL_URL ? describe : describe.skip;

@Controller('redis-full')
class ProbeController {
  @Get()
  reach() {
    return { reached: true };
  }

  @Get('tight')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  tight() {
    return { reached: true };
  }
}

async function fillWith(redis: Redis, value: string): Promise<string> {
  for (let i = 0; i < MAX_FILL_WRITES; i++) {
    try {
      await redis.set(`e2e-full:fill:${value.length}:${i}`, value);
    } catch (error: unknown) {
      return (error as Error).message;
    }
  }

  throw new Error(`Redis took ${MAX_FILL_WRITES} writes and is not full`);
}

async function fillToMaxmemory(redis: Redis): Promise<string> {
  let refusal = '';

  for (const value of FILL_VALUES) {
    refusal = await fillWith(redis, value);
  }

  return refusal;
}

runWithRedis('a full Redis under noeviction (real Redis)', () => {
  const url = REDIS_FULL_URL!;
  let redis: Redis;
  let moduleRef: TestingModule;
  let app: INestApplication<Server>;
  let ledger: SingleUseTokenLedger;
  let counter: FailedAttemptCounter;
  let queue: Queue;
  let fillError: string;

  beforeAll(async () => {
    redis = new Redis(url);
    await redis.flushall();

    moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.registerAsync({ useFactory: () => buildCacheOptions(url) }),
        ThrottlerModule.forRootAsync({
          useFactory: () => buildThrottlerOptions(url)
        })
      ],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: LoginThrottlerGuard }]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const cache = moduleRef.get<Cache>(CACHE_MANAGER);

    await cache.get('e2e-full:warmup');
    ledger = new SingleUseTokenLedger(cache, 'e2e-full:spent:', new Logger());
    counter = new FailedAttemptCounter(
      cache,
      'e2e-full:failures:',
      new Logger()
    );
    queue = new Queue(BILLING_RENEWAL_QUEUE, {
      connection: parseRedisConnection(url)
    });
    await queue.waitUntilReady();
    await request(app.getHttpServer()).get('/redis-full').expect(200);

    fillError = await fillToMaxmemory(redis);
  });

  afterAll(async () => {
    await redis.flushall();
    redis.disconnect();
    await queue.close();
    await app.close();
  });

  it('refuses writes once full', () => {
    expect(fillError).toContain('OOM command not allowed');
  });

  it('refuses a single-use claim instead of accepting it twice', async () => {
    await expect(ledger.claim('proof-1', 60_000)).resolves.toBe(false);
    await expect(ledger.claim('proof-1', 60_000)).resolves.toBe(false);
  });

  it('bars the subject of a failed attempt', async () => {
    await expect(counter.record('user-1', 60_000)).resolves.toEqual({
      count: Number.POSITIVE_INFINITY,
      remainingMs: 60_000
    });
  });

  it('keeps a throttled route answering', async () => {
    await request(app.getHttpServer())
      .get('/redis-full')
      .expect(200, { reached: true });
  });

  it('still limits a route, in this process', async () => {
    const server = app.getHttpServer();
    const keysBefore = await redis.dbsize();

    await request(server).get('/redis-full/tight').expect(200);
    await request(server).get('/redis-full/tight').expect(200);
    await request(server).get('/redis-full/tight').expect(429);
    // No hit reached Redis, so the in-process storage gave the 429.
    expect(await redis.dbsize()).toBe(keysBefore);
  });

  it('lets the boot go on when a job schedule cannot be written', async () => {
    const processor = new RenewalProcessor(
      {} as RenewalService,
      {} as RenewalNoticeService,
      queue
    );
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    try {
      await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledWith(
        'Cannot register the renewal scan schedule',
        expect.any(Error)
      );
      expect(logged.mock.calls[0][1]).toHaveProperty(
        'message',
        expect.stringContaining('OOM command not allowed')
      );
    } finally {
      logged.mockRestore();
    }
  });
});
