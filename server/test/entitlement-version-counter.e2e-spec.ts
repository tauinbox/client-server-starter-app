import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { createClient } from '@keyv/redis';
import { buildCacheOptions } from '../src/modules/core/redis-cache.store';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { CustomerGrant } from '../src/modules/billing/entities/customer-grant.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { EntitlementService } from '../src/modules/billing/entitlements/entitlement.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';

const REDIS_URL = process.env['REDIS_URL'];
const COUNTER_KEY = 'entitlements:version:counter';

// The entitlements cache uses the same CacheVersionCounter as feature flags, and
// the atomicity claim is about a Redis command - a mocked client cannot prove
// it. Skipped when REDIS_URL is unset (CI has no Redis service).
const runWithRedis = REDIS_URL ? describe : describe.skip;

runWithRedis('entitlement version counter (real Redis)', () => {
  let moduleRef: TestingModule;
  let service: EntitlementService;
  let cache: Cache;
  let redis: ReturnType<typeof createClient>;

  beforeAll(async () => {
    redis = createClient({ url: REDIS_URL });
    await redis.connect();

    const empty = { findOne: jest.fn().mockResolvedValue(null) };

    moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.registerAsync({
          useFactory: () => buildCacheOptions(REDIS_URL)
        })
      ],
      providers: [
        EntitlementService,
        { provide: getRepositoryToken(Customer), useValue: empty },
        { provide: getRepositoryToken(Subscription), useValue: empty },
        { provide: getRepositoryToken(Plan), useValue: empty },
        {
          provide: getRepositoryToken(CustomerGrant),
          useValue: { find: jest.fn().mockResolvedValue([]) }
        },
        { provide: MetricsService, useValue: { recordCacheAccess: jest.fn() } }
      ]
    }).compile();

    service = moduleRef.get(EntitlementService);
    cache = moduleRef.get<Cache>(CACHE_MANAGER);
    // Firing the concurrency burst at a lazily-connecting client makes every
    // command fail at once and degrade to the in-memory fallback.
    await cache.get('entitlements:warmup');
  });

  afterAll(async () => {
    await redis.del(COUNTER_KEY);
    await redis.quit();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await redis.del(COUNTER_KEY);
  });

  it('never loses an invalidation under concurrency', async () => {
    // The pre-fix read-modify-write could observe the same previous value from
    // several instances and collapse the bumps into one.
    await Promise.all(
      Array.from({ length: 25 }, () => service.invalidateAll())
    );
    expect(await redis.get(COUNTER_KEY)).toBe('25');

    // The counter is deliberately outside the Keyv JSON envelope, which is what
    // makes INCR possible - reading it back through cache-manager must miss.
    expect(await cache.get(COUNTER_KEY)).toBeNull();
  });

  it('starts at version 0 with no write, then keys per-user entries by the counter', async () => {
    await service.capabilitiesFor('u1');
    expect(await cache.get('entitlements:user:u1:v0')).not.toBeNull();
    expect(await redis.exists(COUNTER_KEY)).toBe(0);

    await service.invalidateAll();
    // The bumped suffix orphans the previous entry instead of serving it.
    expect(await cache.get('entitlements:user:u1:v1')).toBeNull();
    await service.capabilitiesFor('u1');
    expect(await cache.get('entitlements:user:u1:v1')).not.toBeNull();
  });
});
