import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { createClient } from '@keyv/redis';
import type { Request } from 'express';
import { buildCacheOptions } from '../src/modules/core/redis-cache.store';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRule } from '../src/modules/feature-flags/entities/feature-flag-rule.entity';
import { AttributeRegistryService } from '../src/modules/feature-flags/services/attribute-registry.service';
import { FeatureFlagResolverService } from '../src/modules/feature-flags/services/feature-flag-resolver.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';

const REDIS_URL = process.env['REDIS_URL'];
const COUNTER_KEY = 'featureflags:version:counter';

// Exercises the version counter against a real Redis through the real cache
// wiring: the atomicity claim is about a Redis command, so a mocked client
// cannot prove it. Skipped when REDIS_URL is unset (CI has no Redis service).
const runWithRedis = REDIS_URL ? describe : describe.skip;

runWithRedis('feature-flag version counter (real Redis)', () => {
  let moduleRef: TestingModule;
  let service: FeatureFlagResolverService;
  let cache: Cache;
  let redis: ReturnType<typeof createClient>;

  const fakeReq = {} as Request;
  const user = {
    userId: 'u1',
    email: null,
    createdAt: null,
    roles: [] as string[]
  };

  beforeAll(async () => {
    redis = createClient({ url: REDIS_URL });
    await redis.connect();

    const flagRepo = { find: jest.fn().mockResolvedValue([]) };
    const ruleRepo = { find: jest.fn().mockResolvedValue([]) };

    moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.registerAsync({
          useFactory: () => buildCacheOptions(REDIS_URL)
        })
      ],
      providers: [
        FeatureFlagResolverService,
        { provide: getRepositoryToken(FeatureFlag), useValue: flagRepo },
        { provide: getRepositoryToken(FeatureFlagRule), useValue: ruleRepo },
        {
          provide: AttributeRegistryService,
          useValue: new AttributeRegistryService()
        },
        {
          provide: ConfigService,
          useValue: { get: (): string => 'production' }
        },
        {
          provide: PermissionService,
          useValue: { getRoleNamesForUser: jest.fn().mockResolvedValue([]) }
        },
        {
          provide: UsersService,
          useValue: { findOne: jest.fn().mockResolvedValue(null) }
        },
        { provide: MetricsService, useValue: { recordCacheAccess: jest.fn() } }
      ]
    }).compile();

    service = moduleRef.get(FeatureFlagResolverService);
    cache = moduleRef.get<Cache>(CACHE_MANAGER);
  });

  afterAll(async () => {
    await redis.del(COUNTER_KEY);
    await redis.quit();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await redis.del(COUNTER_KEY);
  });

  it('increments a plain Redis integer that survives a cache round-trip', async () => {
    await service.invalidateAll();
    expect(await redis.get(COUNTER_KEY)).toBe('1');

    await service.invalidateAll();
    expect(await redis.get(COUNTER_KEY)).toBe('2');

    // The counter is deliberately outside the Keyv JSON envelope, which is what
    // makes INCR possible - reading it back through cache-manager must miss.
    expect(await cache.get(COUNTER_KEY)).toBeNull();
  });

  it('never loses an invalidation under concurrency', async () => {
    await Promise.all(
      Array.from({ length: 25 }, () => service.invalidateAll())
    );
    expect(await redis.get(COUNTER_KEY)).toBe('25');
  });

  it('keys the per-user cache by the current counter value', async () => {
    await service.invalidateAll();
    await service.evaluateForUser(user, fakeReq);
    expect(await cache.get('featureflags:user:u1:v1')).not.toBeNull();

    await service.invalidateAll();
    // The bumped suffix orphans the previous entry instead of serving it.
    expect(await cache.get('featureflags:user:u1:v2')).toBeNull();
    await service.evaluateForUser(user, fakeReq);
    expect(await cache.get('featureflags:user:u1:v2')).not.toBeNull();
  });

  it('starts at version 0 with no write when nothing has been invalidated', async () => {
    await service.evaluateForUser(user, fakeReq);
    expect(await cache.get('featureflags:user:u1:v0')).not.toBeNull();
    expect(await redis.exists(COUNTER_KEY)).toBe(0);
  });
});
