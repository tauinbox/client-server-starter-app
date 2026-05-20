// End-to-end integration coverage for the feature-flags subsystem.
//
// Wires real FeatureFlagService + FeatureFlagResolverService +
// AttributeRegistryService + FeatureFlagChangedListener against in-memory
// repository stand-ins. Exercises the full happy path (create flag → add
// percentage rule → evaluate per user) plus the load-bearing edge cases:
// optimistic-lock 409, deny-overrides, public vs anonymous filtering, SSE
// broadcast on change, and the @RequireFeature guard's 404-on-disabled
// anti-enumeration response.

import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpStatus,
  Injectable
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import type { Server } from 'http';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRule } from '../src/modules/feature-flags/entities/feature-flag-rule.entity';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';
import { FeatureFlagResolverService } from '../src/modules/feature-flags/services/feature-flag-resolver.service';
import { AttributeRegistryService } from '../src/modules/feature-flags/services/attribute-registry.service';
import { FeatureFlagChangedListener } from '../src/modules/feature-flags/listeners/feature-flag-changed.listener';
import { FeatureFlagChangedEvent } from '../src/modules/feature-flags/events/feature-flag-changed.event';
import { FeatureFlagGuard } from '../src/modules/feature-flags/guards/feature-flag.guard';
import { RequireFeature } from '../src/modules/feature-flags/decorators/require-feature.decorator';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { percentageBucket } from '@app/shared/utils/feature-flag-evaluator';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';

// ── In-memory repository stand-ins ─────────────────────────────────────────

interface Stores {
  flags: Map<string, FeatureFlag>;
  rules: Map<string, FeatureFlagRule>;
}

function createStores(): Stores {
  return { flags: new Map(), rules: new Map() };
}

function nowDate(): Date {
  return new Date();
}

function makeFlagRepoMock(stores: Stores) {
  return {
    find: jest.fn((opts?: { order?: unknown; relations?: string[] }) => {
      const list = Array.from(stores.flags.values()).map((f) => ({
        ...f,
        rules:
          opts?.relations?.includes('rules') === true
            ? Array.from(stores.rules.values()).filter((r) => r.flagId === f.id)
            : []
      }));
      list.sort((a, b) => a.key.localeCompare(b.key));
      return Promise.resolve(list);
    }),
    findOne: jest.fn((opts: { where: { id?: string; key?: string } }) => {
      for (const f of stores.flags.values()) {
        if (opts.where.id !== undefined && f.id === opts.where.id) {
          return Promise.resolve({
            ...f,
            rules: Array.from(stores.rules.values()).filter(
              (r) => r.flagId === f.id
            )
          });
        }
        if (opts.where.key !== undefined && f.key === opts.where.key) {
          return Promise.resolve({ ...f, rules: [] });
        }
      }
      return Promise.resolve(null);
    }),
    create: (data: Partial<FeatureFlag>): FeatureFlag => {
      const f = new FeatureFlag();
      Object.assign(f, data);
      return f;
    },
    save: jest.fn((entity: FeatureFlag) => {
      if (!entity.id) entity.id = `flag-${stores.flags.size + 1}`;
      if (!entity.createdAt) entity.createdAt = nowDate();
      entity.updatedAt = nowDate();
      stores.flags.set(entity.id, entity);
      return Promise.resolve(entity);
    }),
    update: jest.fn(
      (id: string, patch: Partial<FeatureFlag> & { version?: unknown }) => {
        const existing = stores.flags.get(id);
        if (!existing) return Promise.resolve({ affected: 0 });
        const versionExpr = patch.version;
        const versionValue =
          typeof versionExpr === 'function'
            ? existing.version + 1
            : typeof versionExpr === 'number'
              ? versionExpr
              : existing.version;
        Object.assign(existing, patch, {
          version: versionValue,
          updatedAt: nowDate()
        });
        return Promise.resolve({ affected: 1 });
      }
    ),
    remove: jest.fn((entity: FeatureFlag) => {
      stores.flags.delete(entity.id);
      for (const r of Array.from(stores.rules.values())) {
        if (r.flagId === entity.id) stores.rules.delete(r.id);
      }
      return Promise.resolve(entity);
    }),
    createQueryBuilder: () => {
      let pendingPatch: Partial<FeatureFlag> & { version?: unknown } = {};
      let whereId = '';
      let whereExpectedVersion = 0;
      return {
        update() {
          return this;
        },
        set(patch: Partial<FeatureFlag> & { version?: unknown }) {
          pendingPatch = patch;
          return this;
        },
        where(_clause: string, params: { id: string; expected: number }) {
          whereId = params.id;
          whereExpectedVersion = params.expected;
          return this;
        },
        execute(): Promise<{ affected: number }> {
          const existing = stores.flags.get(whereId);
          if (!existing || existing.version !== whereExpectedVersion) {
            return Promise.resolve({ affected: 0 });
          }
          const versionExpr = pendingPatch.version;
          const versionValue =
            typeof versionExpr === 'function'
              ? existing.version + 1
              : typeof versionExpr === 'number'
                ? versionExpr
                : existing.version;
          const next = { ...existing, ...pendingPatch, version: versionValue };
          next.updatedAt = nowDate();
          stores.flags.set(whereId, next);
          return Promise.resolve({ affected: 1 });
        }
      };
    }
  };
}

function makeRuleRepoMock(stores: Stores) {
  return {
    find: jest.fn(
      (opts?: {
        where?: { flagId?: { _type?: string; _value?: unknown } | string };
      }) => {
        const flagId = opts?.where?.flagId;
        const list = Array.from(stores.rules.values()).filter((r) => {
          if (flagId === undefined) return true;
          if (typeof flagId === 'string') return r.flagId === flagId;
          // typeorm In() shape: object with internal markers; for tests treat as union
          const v = flagId as { _value?: unknown };
          if (Array.isArray(v._value)) return v._value.includes(r.flagId);
          return true;
        });
        return Promise.resolve(list);
      }
    )
  };
}

function makeDataSourceMock(stores: Stores): DataSource {
  return {
    transaction: jest.fn(
      async (cb: (em: TransactionalEntityManager) => Promise<unknown>) => {
        const em: TransactionalEntityManager = {
          delete(
            _entity: unknown,
            where: { flagId: string }
          ): Promise<{ affected: number }> {
            let affected = 0;
            for (const r of Array.from(stores.rules.values())) {
              if (r.flagId === where.flagId) {
                stores.rules.delete(r.id);
                affected++;
              }
            }
            return Promise.resolve({ affected });
          },
          create(
            _entity: unknown,
            data: Partial<FeatureFlagRule>
          ): FeatureFlagRule {
            const r = new FeatureFlagRule();
            Object.assign(r, data);
            return r;
          },
          save(
            _entity: unknown,
            recordOrRecords: FeatureFlagRule | FeatureFlagRule[]
          ): Promise<FeatureFlagRule | FeatureFlagRule[]> {
            const records = Array.isArray(recordOrRecords)
              ? recordOrRecords
              : [recordOrRecords];
            for (const r of records) {
              if (!r.id) r.id = `rule-${stores.rules.size + 1}`;
              if (!r.createdAt) r.createdAt = nowDate();
              r.updatedAt = nowDate();
              stores.rules.set(r.id, r);
            }
            return Promise.resolve(recordOrRecords);
          },
          update(
            _entity: unknown,
            where: { id: string },
            patch: Partial<FeatureFlag> & { version?: unknown }
          ): Promise<{ affected: number }> {
            const existing = stores.flags.get(where.id);
            if (!existing) return Promise.resolve({ affected: 0 });
            const versionExpr = patch.version;
            const versionValue =
              typeof versionExpr === 'function'
                ? existing.version + 1
                : typeof versionExpr === 'number'
                  ? versionExpr
                  : existing.version;
            Object.assign(existing, patch, {
              version: versionValue,
              updatedAt: nowDate()
            });
            return Promise.resolve({ affected: 1 });
          }
        };
        return cb(em);
      }
    )
  } as unknown as DataSource;
}

interface TransactionalEntityManager {
  delete(
    entity: unknown,
    where: { flagId: string }
  ): Promise<{ affected: number }>;
  create(entity: unknown, data: Partial<FeatureFlagRule>): FeatureFlagRule;
  save(
    entity: unknown,
    recordOrRecords: FeatureFlagRule | FeatureFlagRule[]
  ): Promise<FeatureFlagRule | FeatureFlagRule[]>;
  update(
    entity: unknown,
    where: { id: string },
    patch: Partial<FeatureFlag> & { version?: unknown }
  ): Promise<{ affected: number }>;
}

function makeCacheMock(): {
  store: Map<string, unknown>;
  manager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
} {
  const store = new Map<string, unknown>();
  return {
    store,
    manager: {
      get: jest.fn((k: string) => Promise.resolve(store.get(k))),
      set: jest.fn((k: string, v: unknown) => {
        store.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn((k: string) => {
        store.delete(k);
        return Promise.resolve();
      })
    }
  };
}

describe('Feature flags end-to-end', () => {
  let stores: Stores;
  let flagService: FeatureFlagService;
  let resolver: FeatureFlagResolverService;
  let listener: FeatureFlagChangedListener;
  let notifications: {
    push: jest.Mock;
    pushToAll: jest.Mock;
  };
  let cache: ReturnType<typeof makeCacheMock>;

  beforeEach(async () => {
    stores = createStores();
    cache = makeCacheMock();
    notifications = { push: jest.fn(), pushToAll: jest.fn() };

    const flagRepo = makeFlagRepoMock(stores);
    const ruleRepo = makeRuleRepoMock(stores);
    const dataSource = makeDataSourceMock(stores);

    const moduleRef = await Test.createTestingModule({
      providers: [
        FeatureFlagService,
        FeatureFlagResolverService,
        AttributeRegistryService,
        FeatureFlagChangedListener,
        { provide: getRepositoryToken(FeatureFlag), useValue: flagRepo },
        { provide: getRepositoryToken(FeatureFlagRule), useValue: ruleRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: CACHE_MANAGER, useValue: cache.manager },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('production') }
        }
      ]
    }).compile();

    flagService = moduleRef.get(FeatureFlagService);
    resolver = moduleRef.get(FeatureFlagResolverService);
    listener = moduleRef.get(FeatureFlagChangedListener);
  });

  it('happy path: admin creates flag, adds 10% rule, bucketed user sees true after bump to 100%', async () => {
    const flag = await flagService.create(
      { key: 'beta-export', enabled: true, public: false },
      'actor-1'
    );

    const user = {
      userId: 'user-7',
      email: 'u7@example.com',
      createdAt: null,
      roles: []
    };
    const fakeReq = {} as Parameters<typeof resolver.evaluateForUser>[1];

    // No rules → enabled flag returns true for any user.
    const evaluated = await resolver.evaluateForUser(user, fakeReq);
    expect(evaluated.flags['beta-export']).toBe(true);

    // Add 10% include rule. Pick a userId that lands ABOVE the 10 bucket.
    const aboveBucketId = (() => {
      for (let i = 0; i < 200; i++) {
        if (percentageBucket(`u-${i}`, 'beta-export') >= 10) return `u-${i}`;
      }
      throw new Error('expected at least one id above bucket 10');
    })();
    const belowBucketId = (() => {
      for (let i = 0; i < 200; i++) {
        if (percentageBucket(`u-${i}`, 'beta-export') < 10) return `u-${i}`;
      }
      throw new Error('expected at least one id below bucket 10');
    })();

    await flagService.replaceRules(
      flag.id,
      [
        {
          type: 'percentage',
          effect: 'include',
          payload: { type: 'percentage', percent: 10 }
        }
      ],
      'actor-1'
    );
    await resolver.invalidateAll();

    const insider = await resolver.evaluateForUser(
      { ...user, userId: belowBucketId },
      fakeReq
    );
    expect(insider.flags['beta-export']).toBe(true);

    const outsider = await resolver.evaluateForUser(
      { ...user, userId: aboveBucketId },
      fakeReq
    );
    expect(outsider.flags['beta-export']).toBe(false);

    // Bump to 100% — everyone gets true.
    await flagService.replaceRules(
      flag.id,
      [
        {
          type: 'percentage',
          effect: 'include',
          payload: { type: 'percentage', percent: 100 }
        }
      ],
      'actor-1'
    );
    await resolver.invalidateAll();

    const all = await resolver.evaluateForUser(
      { ...user, userId: aboveBucketId },
      fakeReq
    );
    expect(all.flags['beta-export']).toBe(true);
  });

  it('deny-overrides: exclude rule beats include rule for the same user', async () => {
    const flag = await flagService.create(
      { key: 'risky-feature', enabled: true },
      'actor-1'
    );
    await flagService.replaceRules(
      flag.id,
      [
        {
          type: 'role',
          effect: 'include',
          payload: { type: 'role', roleNames: ['beta'] }
        },
        {
          type: 'role',
          effect: 'exclude',
          payload: { type: 'role', roleNames: ['banned'] }
        }
      ],
      'actor-1'
    );
    await resolver.invalidateAll();

    const beta = await resolver.evaluateForUser(
      { userId: 'u-1', email: null, createdAt: null, roles: ['beta'] },
      {} as Parameters<typeof resolver.evaluateForUser>[1]
    );
    expect(beta.flags['risky-feature']).toBe(true);

    const banned = await resolver.evaluateForUser(
      {
        userId: 'u-2',
        email: null,
        createdAt: null,
        roles: ['beta', 'banned']
      },
      {} as Parameters<typeof resolver.evaluateForUser>[1]
    );
    expect(banned.flags['risky-feature']).toBe(false);
  });

  it('PATCH /:id rejects a stale version with HTTP 409', async () => {
    const flag = await flagService.create(
      { key: 'v-lock', enabled: false },
      'actor-1'
    );
    expect(flag.version).toBe(1);

    // Concurrent edit from another caller — bumps version to 2.
    const next = await flagService.update(
      flag.id,
      { enabled: true },
      1,
      'actor-2'
    );
    expect(next.version).toBe(2);

    // Stale PATCH at v1 → 409.
    await expect(
      flagService.update(flag.id, { enabled: false }, 1, 'actor-3')
    ).rejects.toMatchObject({ status: 409 });
  });

  it('FeatureFlagChangedEvent invalidates cache and broadcasts SSE', async () => {
    // Prime cache.
    await resolver.evaluateForUser(
      { userId: 'u-1', email: null, createdAt: null, roles: [] },
      {} as Parameters<typeof resolver.evaluateForUser>[1]
    );
    expect(cache.store.has('featureflags:all')).toBe(true);

    await listener.handleFeatureFlagChanged(
      new FeatureFlagChangedEvent('new-dashboard', 'toggled')
    );

    expect(cache.store.has('featureflags:all')).toBe(false);
    expect(notifications.pushToAll).toHaveBeenCalledWith({
      type: 'feature_flags_updated'
    });
  });

  it('UserRoleChangedEvent invalidates only the affected user', async () => {
    await listener.handleUserRoleChanged({ userId: 'u-42' });
    expect(notifications.push).toHaveBeenCalledWith('u-42', {
      type: 'feature_flags_updated'
    });
    expect(notifications.pushToAll).not.toHaveBeenCalled();
  });

  it('anonymous evaluation filters to public flags only', async () => {
    await flagService.create(
      { key: 'public-banner', enabled: true, public: true },
      'actor-1'
    );
    await flagService.create(
      { key: 'private-tool', enabled: true, public: false },
      'actor-1'
    );

    const anon = await resolver.evaluateAnonymous(
      'anon-cookie-1',
      {} as Parameters<typeof resolver.evaluateAnonymous>[1]
    );
    expect(anon.flags['public-banner']).toBe(true);
    expect('private-tool' in anon.flags).toBe(false);
  });
});

// ── @RequireFeature guard HTTP integration ─────────────────────────────────

@Controller('test-feature')
class TestFeatureController {
  @Get('beta')
  @RequireFeature('beta')
  getBeta(): { ok: boolean } {
    return { ok: true };
  }
}

@Injectable()
class PassThroughJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<JwtAuthRequest>();
    req.user = {
      userId: 'caller-1',
      email: 'caller@example.com',
      roles: []
    };
    return true;
  }
}

describe('@RequireFeature guard', () => {
  let app: INestApplication;
  let server: Server;
  let resolverIsEnabled: jest.Mock;

  beforeEach(async () => {
    resolverIsEnabled = jest.fn();
    const moduleRef = await Test.createTestingModule({
      controllers: [TestFeatureController],
      providers: [
        Reflector,
        FeatureFlagGuard,
        { provide: APP_GUARD, useClass: PassThroughJwtGuard },
        {
          provide: FeatureFlagResolverService,
          useValue: { isEnabledForUser: resolverIsEnabled }
        },
        {
          provide: PermissionService,
          useValue: { getRoleNamesForUser: jest.fn().mockResolvedValue([]) }
        },
        {
          provide: UsersService,
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              email: 'caller@example.com',
              createdAt: new Date()
            })
          }
        }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 when the flag is enabled for the caller', async () => {
    resolverIsEnabled.mockResolvedValue(true);
    await request(server)
      .get('/test-feature/beta')
      .expect(HttpStatus.OK)
      .expect({ ok: true });
  });

  it('returns 404 (anti-enumeration) when the flag is disabled', async () => {
    resolverIsEnabled.mockResolvedValue(false);
    await request(server)
      .get('/test-feature/beta')
      .expect(HttpStatus.NOT_FOUND);
  });
});
