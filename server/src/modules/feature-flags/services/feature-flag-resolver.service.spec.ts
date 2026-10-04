import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { percentageBucket } from '@app/shared/utils/feature-flag-evaluator';
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
      })
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
    usersService.findOne.mockRejectedValueOnce(
      new HttpException('User with ID u1 not found', HttpStatus.NOT_FOUND)
    );
    const user = await service.buildResolverUser('u1');
    expect(user).toEqual({
      userId: 'u1',
      email: null,
      createdAt: null,
      roles: ['admin']
    });
  });

  it('buildResolverUser rethrows a lookup error that is not a 404', async () => {
    const failure = new Error('connection terminated');
    usersService.findOne.mockRejectedValueOnce(failure);
    await expect(service.buildResolverUser('u1')).rejects.toBe(failure);
  });

  it('isEnabledForUserId fails closed for an excluded user when the lookup fails', async () => {
    seedFlags(
      [{ id: 'f1', key: 'gated', enabled: true }],
      [
        {
          flagId: 'f1',
          type: 'attribute',
          effect: 'exclude',
          payload: {
            type: 'attribute',
            field: 'emailDomain',
            op: 'eq',
            value: 'b.com'
          }
        }
      ]
    );
    expect(await service.isEnabledForUserId('u1', 'gated')).toBe(false);

    usersService.findOne.mockRejectedValueOnce(
      new Error('connection terminated')
    );
    await expect(service.isEnabledForUserId('u1', 'gated')).rejects.toThrow(
      'connection terminated'
    );
  });

  it('isEnabledForUserId applies environments and rules, and is false for a missing flag', async () => {
    seedFlags([
      { id: 'f1', key: 'other-env', enabled: true, environments: ['staging'] },
      { id: 'f2', key: 'role-gated', enabled: true },
      { id: 'f3', key: 'on', enabled: true }
    ]);
    ruleRepo.find.mockResolvedValue([
      {
        id: 'r1',
        flagId: 'f2',
        type: 'role',
        effect: 'include',
        payload: { type: 'role', roleNames: ['beta'] },
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    expect(await service.isEnabledForUserId('u1', 'other-env')).toBe(false);
    expect(await service.isEnabledForUserId('u1', 'role-gated')).toBe(false);
    expect(await service.isEnabledForUserId('u1', 'on')).toBe(true);
    expect(await service.isEnabledForUserId('u1', 'missing')).toBe(false);
    expect(usersService.findOne).toHaveBeenCalledWith('u1');
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

  it('evaluates the current user attributes on every call', async () => {
    seedFlags(
      [{ id: 'f1', key: 'gated', enabled: true }],
      [
        {
          flagId: 'f1',
          type: 'attribute',
          payload: {
            type: 'attribute',
            field: 'emailDomain',
            op: 'eq',
            value: 'a.com'
          }
        }
      ]
    );
    const user = { userId: 'u1', createdAt: null, roles: [] };

    expect(
      await service.isEnabledForUser(
        { ...user, email: 'x@a.com' },
        fakeReq,
        'gated'
      )
    ).toBe(true);
    expect(
      await service.isEnabledForUser(
        { ...user, email: 'x@b.com' },
        fakeReq,
        'gated'
      )
    ).toBe(false);
    expect([...cacheStore.keys()]).toEqual(['featureflags:all']);
  });

  it('records a feature_flags_all miss then hit across two evaluations', async () => {
    seedFlags([{ id: 'f1', key: 'a', enabled: true }]);
    const user = { userId: 'u1', email: null, createdAt: null, roles: [] };

    await service.evaluateForUser(user, fakeReq);
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'feature_flags_all',
      'miss'
    );

    metrics.recordCacheAccess.mockClear();

    await service.evaluateForUser(user, fakeReq);
    expect(metrics.recordCacheAccess).toHaveBeenCalledTimes(1);
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'feature_flags_all',
      'hit'
    );
  });

  it('anonymous evaluation returns only public flags', async () => {
    seedFlags([
      { id: 'f1', key: 'pub', enabled: true, public: true },
      { id: 'f2', key: 'priv', enabled: true, public: false }
    ]);
    const { result } = await service.evaluateAnonymous('anon-1', fakeReq);
    expect(result.flags['pub']).toBe(true);
    expect('priv' in result.flags).toBe(false);
  });

  describe('anonymous rollout id', () => {
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    it('issues no id when no public flag has a percentage rule', async () => {
      seedFlags(
        [
          { id: 'f1', key: 'pub-attr', public: true },
          { id: 'f2', key: 'priv-pct', public: false }
        ],
        [
          {
            flagId: 'f1',
            type: 'attribute',
            payload: {
              type: 'attribute',
              field: 'custom',
              customKey: 'k',
              op: 'eq',
              value: 1
            }
          },
          { flagId: 'f2' }
        ]
      );
      const { issuedAnonId } = await service.evaluateAnonymous(null, fakeReq);
      expect(issuedAnonId).toBeNull();
    });

    it('issues a UUID and buckets with it when a public percentage flag is live', async () => {
      seedFlags(
        [{ id: 'f1', key: 'pub-pct', public: true }],
        [{ flagId: 'f1' }]
      );
      const { result, issuedAnonId } = await service.evaluateAnonymous(
        null,
        fakeReq
      );
      expect(issuedAnonId).toMatch(UUID);
      // percent 100: the flag is on only when the evaluation saw the new id.
      expect(result.flags['pub-pct']).toBe(true);
    });

    it('keeps an id the visitor already holds', async () => {
      seedFlags(
        [{ id: 'f1', key: 'pub-pct', public: true }],
        [{ flagId: 'f1' }]
      );
      const { result, issuedAnonId } = await service.evaluateAnonymous(
        'held-id',
        fakeReq
      );
      expect(issuedAnonId).toBeNull();
      expect(result.flags['pub-pct']).toBe(true);
    });

    it.each([
      ['disabled', { enabled: false }],
      ['scoped to another environment', { environments: ['staging'] }]
    ])(
      'issues no id for a percentage flag that is %s',
      async (_label, over) => {
        seedFlags(
          [{ id: 'f1', key: 'pub-pct', public: true, ...over }],
          [{ flagId: 'f1' }]
        );
        const { issuedAnonId } = await service.evaluateAnonymous(null, fakeReq);
        expect(issuedAnonId).toBeNull();
      }
    );

    it('issues an id for a percentage flag scoped to the current environment', async () => {
      seedFlags(
        [
          {
            id: 'f1',
            key: 'pub-pct',
            public: true,
            environments: ['production']
          }
        ],
        [{ flagId: 'f1', effect: 'exclude' }]
      );
      const { issuedAnonId } = await service.evaluateAnonymous(null, fakeReq);
      expect(issuedAnonId).toMatch(UUID);
    });
  });

  describe('signed-in rollout id', () => {
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const user = {
      userId: 'u1',
      email: 'a@b.com',
      createdAt: null,
      roles: []
    };
    const deviceRule = (percent: number) => ({
      flagId: 'f1',
      payload: {
        type: 'percentage' as const,
        percent,
        bucketBy: 'device' as const
      }
    });
    // Two ids on opposite sides of a 50 % split for the flag key `dev-pct`.
    const inId = pickAnonId((b) => b < 50);
    const outId = pickAnonId((b) => b >= 50);

    function pickAnonId(fits: (bucket: number) => boolean): string {
      for (let i = 0; ; i++) {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
        if (fits(percentageBucket(id, 'dev-pct'))) return id;
      }
    }

    it('issues no id when no rule buckets by device', async () => {
      seedFlags([{ id: 'f1', key: 'pct' }], [{ flagId: 'f1' }]);
      const { result, issuedAnonId } = await service.evaluateSignedIn(
        user,
        null,
        fakeReq
      );
      expect(issuedAnonId).toBeNull();
      expect(result.flags['pct']).toBe(true);
    });

    it('issues an id for a device rule on a flag that is not public', async () => {
      seedFlags([{ id: 'f1', key: 'dev-pct' }], [deviceRule(100)]);
      const { result, issuedAnonId } = await service.evaluateSignedIn(
        user,
        null,
        fakeReq
      );
      expect(issuedAnonId).toMatch(UUID);
      expect(result.flags['dev-pct']).toBe(true);
    });

    it('buckets a device rule by the anon id, not the user id', async () => {
      seedFlags([{ id: 'f1', key: 'dev-pct' }], [deviceRule(50)]);
      const inside = await service.evaluateSignedIn(user, inId, fakeReq);
      const outside = await service.evaluateSignedIn(user, outId, fakeReq);
      expect(inside.result.flags).toEqual({ 'dev-pct': true });
      expect(inside.issuedAnonId).toBeNull();
      expect(outside.result.flags['dev-pct']).toBeUndefined();
    });

    it('never opens a device rule for an evaluation without an anon id', async () => {
      seedFlags([{ id: 'f1', key: 'dev-pct' }], [deviceRule(100)]);
      expect(await service.isEnabledForUser(user, fakeReq, 'dev-pct')).toBe(
        false
      );
    });
  });

  it('invalidateAll makes the next evaluation reload the flags', async () => {
    seedFlags([{ id: 'f1', key: 'a', enabled: true }]);
    const user = { userId: 'u1', email: null, createdAt: null, roles: [] };
    await service.evaluateForUser(user, fakeReq);

    await service.invalidateAll();
    flagRepo.find.mockClear();
    await service.evaluateForUser(user, fakeReq);
    expect(flagRepo.find).toHaveBeenCalledTimes(1);
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
    expect(a.result.flags['pub']).toBe(true);
    expect(b.result.flags['pub']).toBe(true);
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
    const { result } = await service.evaluateAnonymous('anon-1', fakeReq);
    expect(flagRepo.find).toHaveBeenCalledTimes(1);
    expect(result.flags['fresh']).toBe(true);
  });
});
