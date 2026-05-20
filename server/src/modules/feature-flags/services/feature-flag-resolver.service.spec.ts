import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { FeatureFlagResolverService } from './feature-flag-resolver.service';
import { AttributeRegistryService } from './attribute-registry.service';
import { FeatureFlag } from '../entities/feature-flag.entity';
import { FeatureFlagRule } from '../entities/feature-flag-rule.entity';

describe('FeatureFlagResolverService', () => {
  let service: FeatureFlagResolverService;
  let flagRepo: { find: jest.Mock };
  let ruleRepo: { find: jest.Mock };
  let cacheStore: Map<string, unknown>;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let configService: { get: jest.Mock };

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
      })
    };
    flagRepo = { find: jest.fn() };
    ruleRepo = { find: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('production') };

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
        { provide: ConfigService, useValue: configService }
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

  it('returns evaluated booleans for an authenticated user', async () => {
    seedFlags([{ id: 'f1', key: 'a', enabled: true, public: false }]);
    const result = await service.evaluateForUser(
      { userId: 'u1', email: 'a@b.com', createdAt: null, roles: [] },
      fakeReq
    );
    expect(result.flags['a']).toBe(true);
    expect(typeof result.evaluatedAt).toBe('string');
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
