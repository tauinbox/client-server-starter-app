import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import type { AppAbility } from '../src/modules/auth/casl/app-ability';
import { RolesController } from '../src/modules/auth/controllers/roles.controller';
import { RoleService } from '../src/modules/auth/services/role.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { Role } from '../src/modules/auth/entities/role.entity';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRule } from '../src/modules/feature-flags/entities/feature-flag-rule.entity';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';
import { FeatureFlagResolverService } from '../src/modules/feature-flags/services/feature-flag-resolver.service';
import { AttributeRegistryService } from '../src/modules/feature-flags/services/attribute-registry.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { User } from '../src/modules/users/entities/user.entity';
import { flagAuditActor } from './flag-audit-actor';

// Two server instances share one flags cache. A load in the second instance
// that read the rows before a change must not put them back after the first
// instance invalidated the cache.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Feature flag cache across instances (e2e)', () => {
  const tag = `flag-cache-instances-${Date.now()}`;
  const email = `${tag}@example.com`;

  let app: INestApplication;
  let dataSource: DataSource;
  const ability = (() => {
    const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
    builder.can('manage', 'all');
    return builder.build();
  })();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (dataSource) {
      await dataSource
        .getRepository(FeatureFlag)
        .createQueryBuilder()
        .delete()
        .where('key LIKE :prefix', { prefix: `${tag}%` })
        .execute();
      await dataSource
        .getRepository(Role)
        .createQueryBuilder()
        .delete()
        .where('name LIKE :prefix', { prefix: `${tag}%` })
        .execute();
      await dataSource.getRepository(User).delete({ email });
    }
    await app?.close();
  });

  /**
   * A second instance of the resolver on the same cache. Its cache writes wait
   * for `release`, so its load can read the rows before a change and write
   * them after the invalidation of the first instance.
   */
  function secondInstance(release: Promise<void>): {
    resolver: FeatureFlagResolverService;
    reachedWrite: Promise<void>;
  } {
    const cache = app.get<Cache>(CACHE_MANAGER);
    let markReached: () => void = () => undefined;
    const reachedWrite = new Promise<void>((resolve) => {
      markReached = resolve;
    });
    const gatedCache = {
      stores: cache.stores,
      get: cache.get.bind(cache),
      del: cache.del.bind(cache),
      set: async (...args: Parameters<Cache['set']>) => {
        markReached();
        await release;
        return cache.set(...args);
      }
    };
    const resolver = new FeatureFlagResolverService(
      app.get(getRepositoryToken(FeatureFlag)),
      app.get(getRepositoryToken(FeatureFlagRule)),
      // @ts-expect-error - partial Cache: the resolver uses get/set/del and stores
      gatedCache,
      app.get(AttributeRegistryService),
      app.get(ConfigService),
      app.get(PermissionService),
      app.get(UsersService),
      app.get(MetricsService)
    );
    return { resolver, reachedWrite };
  }

  it('keeps a role holder on the flag when the other instance writes a pre-rename load', async () => {
    const users = dataSource.getRepository(User);
    const holder = await users.save(
      users.create({
        email,
        name: 'Flag Holder',
        isEmailVerified: true,
        password: null
      })
    );
    const roleService = app.get(RoleService);
    const role = await roleService.create(
      { name: `${tag}-beta` },
      SYSTEM_ABILITY
    );
    await roleService.assignRoleToUser(holder.id, role.id, SYSTEM_ABILITY);
    const key = `${tag}-flag`;
    await app.get(FeatureFlagService).create(
      {
        key,
        enabled: true,
        rules: [
          {
            effect: 'include',
            payload: { type: 'role', roleNames: [role.name] }
          }
        ]
      },
      SYSTEM_ABILITY,
      flagAuditActor()
    );
    const resolver = app.get(FeatureFlagResolverService);
    await resolver.invalidateAll();

    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const other = secondInstance(released);
    const otherLoad = other.resolver.evaluateForUser(
      await other.resolver.buildResolverUser(holder.id),
      null
    );
    await other.reachedWrite;

    // The flag-changed event runs after the commit and the rename does not
    // await it, so the test waits for the invalidation it starts.
    const invalidate = jest.spyOn(resolver, 'invalidateAll');
    const req = { user: { userId: holder.id, email } } as JwtAuthRequest;
    await app
      .get(RolesController)
      .update(role.id, { name: `${role.name}-2` }, req, ability);
    for (let i = 0; i < 1000 && invalidate.mock.results.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(invalidate).toHaveBeenCalledTimes(1);
    await invalidate.mock.results[0].value;
    invalidate.mockRestore();
    release();
    await otherLoad;

    const user = await resolver.buildResolverUser(holder.id);
    expect(user.roles).toEqual([`${role.name}-2`]);
    expect((await resolver.evaluateForUser(user, null)).flags[key]).toBe(true);
  });
});
