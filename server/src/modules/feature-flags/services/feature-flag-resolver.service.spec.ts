import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';
import type { Request } from 'express';
import { FeatureFlagResolverService } from './feature-flag-resolver.service';
import { AttributeRegistryService } from './attribute-registry.service';
import { FeatureFlag } from '../entities/feature-flag.entity';
import { FeatureFlagRule } from '../entities/feature-flag-rule.entity';
import { PermissionService } from '../../auth/services/permission.service';
import { UsersService } from '../../users/services/users.service';
import { MetricsService } from '../../core/metrics/metrics.service';

describe('FeatureFlagResolverService', () => {
  let service: FeatureFlagResolverService;
  let flagRepo: { find: jest.Mock };
  let ruleRepo: { find: jest.Mock };
  let cacheStore: Map<string, unknown>;
  let cacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    stores: { store?: unknown }[];
  };
  let configService: { get: jest.Mock };
  let permissionService: { getRoleNamesForUser: jest.Mock };
  let usersService: { findOne: jest.Mock };
  let metrics: { recordCacheAccess: jest.Mock };

  const fakeReq = {} as Request;

  beforeEach(async () => {
    cacheStore = new Map();
    cacheManager = {
      get: jest.fn((k: string) => Promise.resolve(cacheStore.get(k))),
      set: jest.fn((k: string, v: unknown) => {
        cacheStore.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn((k: string) => {
        cacheStore.delete(k);
        return Promise.resolve();
      }),
      // In-memory fallback wiring: no Redis adapter behind the cache.
      stores: [{}]
    };
    flagRepo = { find: jest.fn() };
    ruleRepo = { find: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('production') };
    permissionService = {
      getRoleNamesForUser: jest.fn().mockResolvedValue(['admin'])
    };
    usersService = {
      findOne: jest.fn().mockResolvedValue({
        email: 'a@b.com',
        createdAt: new Date('2026-01-01T00:00:00Z')
      })
    };
    metrics = { recordCacheAccess: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagResolverService,
        { provide: getRepositoryToken(FeatureFlag), useValue: flagRepo },
        { provide: getRepositoryToken(FeatureFlagRule), useValue: ruleRepo },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        {
          provide: AttributeRegistryService,
          useValue: new AttributeRegistryService()
        },
        { provide: ConfigService, useValue: configService },
        { provide: PermissionService, useValue: permissionService },
        { provide: UsersService, useValue: usersService },
        { provide: MetricsService, useValue: metrics }
      ]
    }).compile();

    service = module.get(FeatureFlagResolverService);
  });

  function seedFlags(
    flags: Partial<FeatureFlag>[],
    rules: Partial<FeatureFlagRule>[] = []
  ): void {
    flagRepo.find.mockResolvedValue(
      flags.map((f, i) => ({
        id: f.id ?? `flag-${i}`,
        key: f.key ?? `key-${i}`,
        enabled: f.enabled ?? true,
        environments: f.environments ?? [],
        public: f.public ?? false,
        description: null,
        version: 1,
        updatedByUserId: null,
        rules: [],
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    );
    ruleRepo.find.mockResolvedValue(
      rules.map((r, i) => ({
        id: r.id ?? `rule-${i}`,
        flagId: r.flagId ?? 'flag-0',
        type: r.type ?? 'percentage',
        effect: r.effect ?? 'include',
        payload: r.payload ?? { type: 'percentage', percent: 100 },
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    );
  }

  it('buildResolverUser assembles the user record and roles', async () => {
    const user = await service.buildResolverUser('u1');
    expect(usersService.findOne).toHaveBeenCalledWith('u1');
    expect(permissionService.getRoleNamesForUser).toHaveBeenCalledWith('u1');
    expect(user).toEqual({
      userId: 'u1',
      email: 'a@b.com',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      roles: ['admin']
    });
  });

  it('buildResolverUser falls back to null email/createdAt when the user is gone', async () => {
    usersService.findOne.mockRejectedValueOnce(new Error('orphaned token'));
    const user = await service.buildResolverUser('u1');
    expect(user).toEqual({
      userId: 'u1',
      email: null,
      createdAt: null,
      roles: ['admin']
    });
  });

  it('returns evaluated booleans for an authenticated user', async () => {
    seedFlags([{ id: 'f1', key: 'a', enabled: true, public: false }]);
    const result = await service.evaluateForUser(
      { userId: 'u1', email: 'a@b.com', createdAt: null, roles: [] },
      fakeReq
    );
    expect(result.flags['a']).toBe(true);
    expect(typeof result.evaluatedAt).toBe('string');
  });

  it('omits disabled non-public flags from the authenticated response', async () => {
    seedFlags([
      { id: 'f1', key: 'disabled-private', enabled: false, public: false },
      { id: 'f2', key: 'disabled-public', enabled: false, public: true },
      { id: 'f3', key: 'enabled-private', enabled: true, public: false }
    ]);
    const result = await service.evaluateForUser(
      { userId: 'u1', email: 'a@b.com', createdAt: null, roles: [] },
      fakeReq
    );
    // Disabled non-public flag key must not leak to authenticated callers.
    expect('disabled-private' in result.flags).toBe(false);
    // Disabled-but-public stays present (its existence is intentionally visible).
    expect(result.flags['disabled-public']).toBe(false);
    // Any enabled flag stays present regardless of public.
    expect(result.flags['enabled-private']).toBe(true);
  });

  it('caches per user using the global version', async () => {
    seedFlags([{ id: 'f1', key: 'a', enabled: true }]);
    await service.evaluateForUser(
      { userId: 'u1', email: null, createdAt: null, roles: [] },
      fakeReq
    );
    flagRepo.find.mockClear();
    await service.evaluateForUser(
      { userId: 'u1', email: null, createdAt: null, roles: [] },
      fakeReq
    );
    // Second call should hit the user cache, not re-load.
    expect(flagRepo.find).not.toHaveBeenCalled();
  });

  it('records a feature_flags miss then hit across two evaluations', async () => {
    seedFlags([{ id: 'f1', key: 'a', enabled: true }]);
    const user = { userId: 'u1', email: null, createdAt: null, roles: [] };

    // First evaluation: user cache miss + all-flags cache miss.
    await service.evaluateForUser(user, fakeReq);
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'feature_flags',
      'miss'
    );
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'feature_flags_all',
      'miss'
    );

    metrics.recordCacheAccess.mockClear();

    // Second evaluation: served from the per-user cache.
    await service.evaluateForUser(user, fakeReq);
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'feature_flags',
      'hit'
    );
  });

  it('anonymous evaluation returns only public flags', async () => {
    seedFlags([
      { id: 'f1', key: 'pub', enabled: true, public: true },
      { id: 'f2', key: 'priv', enabled: true, public: false }
    ]);
    const result = await service.evaluateAnonymous('anon-1', fakeReq);
    expect(result.flags['pub']).toBe(true);
    expect('priv' in result.flags).toBe(false);
  });

  it('invalidateAll bumps the version so user caches orphan', async () => {
    seedFlags([{ id: 'f1', key: 'a', enabled: true }]);
    await service.evaluateForUser(
      { userId: 'u1', email: null, createdAt: null, roles: [] },
      fakeReq
    );
    const beforeKeys = [...cacheStore.keys()].filter((k) =>
      k.startsWith('featureflags:user:u1:v')
    );
    expect(beforeKeys).toHaveLength(1);

    // Advance time enough for the bumped version (Date.now()) to differ.
    const realNow = Date.now;
    Date.now = (() => realNow() + 1000) as typeof Date.now;
    await service.invalidateAll();
    Date.now = realNow;

    flagRepo.find.mockClear();
    await service.evaluateForUser(
      { userId: 'u1', email: null, createdAt: null, roles: [] },
      fakeReq
    );
    // The version-suffixed key changed, so the resolver had to re-load.
    expect(flagRepo.find).toHaveBeenCalled();
  });

  it('invalidateAll stays monotonic when Date.now() does not advance', async () => {
    seedFlags([{ id: 'f1', key: 'a', enabled: true }]);
    const realNow = Date.now;
    const frozen = realNow();
    Date.now = (() => frozen) as typeof Date.now;
    try {
      await service.evaluateForUser(
        { userId: 'u1', email: null, createdAt: null, roles: [] },
        fakeReq
      );
      // Two successive invalidations in the same millisecond (fast CI / clock
      // skew across instances) must still produce a strictly newer version,
      // otherwise per-user cache entries from before the first invalidation
      // would be re-reachable after the second.
      await service.invalidateAll();
      await service.invalidateAll();
      flagRepo.find.mockClear();
      await service.evaluateForUser(
        { userId: 'u1', email: null, createdAt: null, roles: [] },
        fakeReq
      );
      expect(flagRepo.find).toHaveBeenCalled();
    } finally {
      Date.now = realNow;
    }
  });

  it('concurrent evaluations share one DB load (single-flight)', async () => {
    let resolveFind!: (flags: Partial<FeatureFlag>[]) => void;
    flagRepo.find.mockReturnValue(
      new Promise<Partial<FeatureFlag>[]>((resolve) => {
        resolveFind = resolve;
      })
    );
    ruleRepo.find.mockResolvedValue([]);

    const first = service.evaluateAnonymous('anon-1', fakeReq);
    const second = service.evaluateAnonymous('anon-2', fakeReq);
    resolveFind([
      { id: 'f1', key: 'pub', enabled: true, environments: [], public: true }
    ]);
    const [a, b] = await Promise.all([first, second]);

    expect(flagRepo.find).toHaveBeenCalledTimes(1);
    expect(a.flags['pub']).toBe(true);
    expect(b.flags['pub']).toBe(true);
  });

  it('a load overlapped by invalidateAll does not repopulate the all-flags cache', async () => {
    let resolveFind!: (flags: Partial<FeatureFlag>[]) => void;
    flagRepo.find.mockReturnValueOnce(
      new Promise<Partial<FeatureFlag>[]>((resolve) => {
        resolveFind = resolve;
      })
    );
    ruleRepo.find.mockResolvedValue([]);

    const inFlight = service.evaluateAnonymous('anon-1', fakeReq);
    // Let the load pass its cache-miss check and reach the (pending) DB read
    // before invalidating, so the invalidation genuinely overlaps it.
    await new Promise((resolve) => setImmediate(resolve));
    await service.invalidateAll();
    resolveFind([
      { id: 'f1', key: 'stale', enabled: true, environments: [], public: true }
    ]);
    await inFlight;

    // The superseded load must not write pre-invalidation rows into the cache.
    expect(cacheStore.has('featureflags:all')).toBe(false);

    // The next evaluation starts a fresh DB load instead of joining the
    // detached stale one.
    seedFlags([{ id: 'f2', key: 'fresh', enabled: true, public: true }]);
    flagRepo.find.mockClear();
    const result = await service.evaluateAnonymous('anon-1', fakeReq);
    expect(flagRepo.find).toHaveBeenCalledTimes(1);
    expect(result.flags['fresh']).toBe(true);
  });

  describe('version counter with a Redis-backed cache', () => {
    let redis: {
      get: jest.Mock;
      incr: jest.Mock;
      on: jest.Mock;
    };
    let counter: number | null;

    async function setupRedisBacked(): Promise<FeatureFlagResolverService> {
      counter = null;
      redis = {
        get: jest.fn(() =>
          Promise.resolve(counter === null ? null : String(counter))
        ),
        incr: jest.fn(() => {
          counter = (counter ?? 0) + 1;
          return Promise.resolve(counter);
        }),
        on: jest.fn()
      };
      // Nest wraps the configured adapter in a Keyv, so the service reaches the
      // adapter at stores[0].store - a real KeyvRedis is required for the
      // instanceof narrowing, but no connection is opened.
      const adapter = new KeyvRedis('redis://localhost:6379');
      // @ts-expect-error stand-in for the node-redis client: only get/incr/on
      // are exercised, and widening the production type for a mock is banned.
      adapter.client = redis;
      cacheManager.stores = [{ store: adapter }];

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FeatureFlagResolverService,
          { provide: getRepositoryToken(FeatureFlag), useValue: flagRepo },
          { provide: getRepositoryToken(FeatureFlagRule), useValue: ruleRepo },
          { provide: CACHE_MANAGER, useValue: cacheManager },
          {
            provide: AttributeRegistryService,
            useValue: new AttributeRegistryService()
          },
          { provide: ConfigService, useValue: configService },
          { provide: PermissionService, useValue: permissionService },
          { provide: UsersService, useValue: usersService },
          { provide: MetricsService, useValue: metrics }
        ]
      }).compile();
      return module.get(FeatureFlagResolverService);
    }

    function userCacheVersions(): string[] {
      return cacheManager.set.mock.calls
        .map((c: unknown[]) => c[0] as string)
        .filter((k) => k.startsWith('featureflags:user:u1:v'))
        .map((k) => k.slice('featureflags:user:u1:v'.length));
    }

    it('bumps the version with an atomic INCR instead of a read-modify-write', async () => {
      const svc = await setupRedisBacked();
      seedFlags([{ id: 'f1', key: 'a', enabled: true }]);

      await svc.invalidateAll();

      expect(redis.incr).toHaveBeenCalledWith('featureflags:version:counter');
      // The racy get -> compute -> set on the version key must be gone.
      expect(cacheManager.set).not.toHaveBeenCalledWith(
        'featureflags:version',
        expect.anything(),
        expect.anything()
      );
    });

    it('gives concurrent invalidations distinct, strictly increasing versions', async () => {
      const svc = await setupRedisBacked();
      seedFlags([{ id: 'f1', key: 'a', enabled: true }]);

      await Promise.all([
        svc.invalidateAll(),
        svc.invalidateAll(),
        svc.invalidateAll()
      ]);

      // Three INCRs means three distinct versions; the pre-fix read-then-write
      // could observe the same previous value and collapse them into one.
      expect(redis.incr).toHaveBeenCalledTimes(3);
      expect(counter).toBe(3);
    });

    it('reads the counter for the per-user cache key and starts at 0', async () => {
      const svc = await setupRedisBacked();
      seedFlags([{ id: 'f1', key: 'a', enabled: true }]);
      const user = { userId: 'u1', email: null, createdAt: null, roles: [] };

      await svc.evaluateForUser(user, fakeReq);
      expect(userCacheVersions()).toEqual(['0']);

      await svc.invalidateAll();
      await svc.evaluateForUser(user, fakeReq);
      expect(userCacheVersions()).toEqual(['0', '1']);
    });

    it('falls back to the cache-manager counter when Redis rejects', async () => {
      const svc = await setupRedisBacked();
      seedFlags([{ id: 'f1', key: 'a', enabled: true }]);
      redis.incr.mockRejectedValue(new Error('connection refused'));
      redis.get.mockRejectedValue(new Error('connection refused'));

      await expect(svc.invalidateAll()).resolves.toBeUndefined();
      expect(cacheManager.set).toHaveBeenCalledWith(
        'featureflags:version',
        expect.any(Number),
        0
      );
    });
  });

  it('invalidateUser deletes that user’s current cache key', async () => {
    seedFlags([{ id: 'f1', key: 'a', enabled: true }]);
    await service.evaluateForUser(
      { userId: 'u1', email: null, createdAt: null, roles: [] },
      fakeReq
    );
    cacheManager.del.mockClear();
    await service.invalidateUser('u1');
    const delKeys = cacheManager.del.mock.calls.map(
      (c: unknown[]) => c[0] as string
    );
    expect(delKeys.some((k) => k.startsWith('featureflags:user:u1:v'))).toBe(
      true
    );
  });
});
