import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { DataSource, In } from 'typeorm';
import type { IfMatchCondition } from '@app/shared/utils/if-match';
import { deleteOrphanRows, splitPoolMax } from '../src/data-sources';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import type { AppAbility } from '../src/modules/auth/casl/app-ability';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { ResourceService } from '../src/modules/auth/services/resource.service';
import { ResourceRegistryService } from '../src/modules/auth/services/resource-registry.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/services/users.service';
import { flagAuditActor } from './flag-audit-actor';
import { settingsDataSourceOf } from './settings-data-source';

// A path that holds a settings connection and takes a second one waits for
// itself here; in production two such requests block the small settings pool.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const POOL_MAX = '4';
const CONNECTION_TIMEOUT_MS = '2000';

runWithInfra('Settings pool of one connection (e2e)', () => {
  const tag = `pool-one-${randomUUID().slice(0, 8)}`;
  const previous = {
    max: process.env['DB_POOL_MAX'],
    timeout: process.env['DB_POOL_CONNECTION_TIMEOUT']
  };
  let app: INestApplication;
  let dataSource: DataSource;
  let settingsDataSource: DataSource;
  let roleService: RoleService;
  let user: User;
  let updateUser: Permission;

  /** Every action on roles and users, but not `manage all`: the scope checks run. */
  const scopedAbility = (): AppAbility => {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    can(['create', 'read', 'update', 'delete', 'assign'], 'Role');
    can(['read', 'update'], 'User');

    return build();
  };

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeAll(async () => {
    process.env['DB_POOL_MAX'] = POOL_MAX;
    process.env['DB_POOL_CONNECTION_TIMEOUT'] = CONNECTION_TIMEOUT_MS;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    jest.spyOn(app.get(AuditService), 'logFireAndForget');
    dataSource = app.get(DataSource);
    settingsDataSource = settingsDataSourceOf(app);
    roleService = app.get(RoleService);
    user = await dataSource.getRepository(User).save({
      email: `${tag}@example.com`,
      name: 'Pool Probe',
      isEmailVerified: true,
      password: null
    });
    updateUser = await settingsDataSource
      .getRepository(Permission)
      .findOneOrFail({
        where: { action: { name: 'update' }, resource: { subject: 'User' } },
        relations: { action: true, resource: true }
      });
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();

    if (settingsDataSource) {
      const flags = await settingsDataSource
        .getRepository(FeatureFlag)
        .findBy({ key: In([`${tag}-flag`]) });

      await settingsDataSource.getRepository(FeatureFlag).remove(flags);
      await settingsDataSource
        .createQueryBuilder()
        .delete()
        .from(Role)
        .where('name LIKE :prefix', { prefix: `${tag}%` })
        .execute();
      await settingsDataSource
        .createQueryBuilder()
        .delete()
        .from(Resource)
        .where('name LIKE :prefix', { prefix: `${tag}%` })
        .execute();
    }

    await dataSource
      ?.getRepository(User)
      .delete({ email: `${tag}@example.com` });
    await app?.close();
    restore('DB_POOL_MAX', previous.max);
    restore('DB_POOL_CONNECTION_TIMEOUT', previous.timeout);
  });

  it('runs on one settings connection, and a second one waits until the timeout', async () => {
    expect(splitPoolMax(Number(POOL_MAX)).settings).toBe(1);

    const holder = settingsDataSource.createQueryRunner();

    await holder.connect();

    try {
      await expect(settingsDataSource.query('SELECT 1')).rejects.toThrow(
        /timeout/i
      );
    } finally {
      await holder.release();
    }
  });

  it('writes and reads roles, grants and holders with a scoped caller', async () => {
    const ability = scopedAbility();
    const role = await roleService.create({ name: `${tag}-role` }, { ability });

    await roleService.assignPermissionsToRole(
      role.id,
      { permissionIds: [updateUser.id] },
      { ability: SYSTEM_ABILITY }
    );
    await roleService.assignRoleToUser(user.id, role.id, { ability });
    await expect(
      app.get(PermissionService).getPermissionsForUser(user.id)
    ).resolves.toEqual(expect.any(Array));
    await expect(
      app.get(PermissionService).filterGrantHolders([user.id], 'update', 'User')
    ).resolves.toEqual([user.id]);
    await expect(
      app.get(UsersService).findCursorPaginated(
        {
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          email: tag,
          role: role.name
        },
        SYSTEM_ABILITY
      )
    ).resolves.toMatchObject({ data: [{ id: user.id }] });
    // The deny row makes each lift below resolve its grants in the transaction.
    await roleService.setPermissionsForRole(
      role.id,
      [
        {
          permissionId: updateUser.id,
          conditions: { effect: 'deny', fieldMatch: { email: ['x@y.z'] } }
        }
      ],
      { ability }
    );
    await roleService.removeRoleFromUser(user.id, role.id, { ability });
    await roleService.removePermissionFromRole(role.id, updateUser.id, {
      ability
    });
    await roleService.update(role.id, { name: `${tag}-renamed` }, { ability });
    await roleService.delete(role.id, { ability });
  }, 60000);

  it('writes a flag with user and role rules and a role rename rewrites it', async () => {
    const flags = app.get(FeatureFlagService);
    const actor = flagAuditActor();
    const role = await roleService.create(
      { name: `${tag}-flagged` },
      { ability: SYSTEM_ABILITY }
    );
    const flag = await flags.create(
      {
        key: `${tag}-flag`,
        rules: [
          { effect: 'include', payload: { type: 'user', userIds: [user.id] } },
          {
            effect: 'include',
            payload: { type: 'role', roleNames: [role.name] }
          }
        ]
      },
      SYSTEM_ABILITY,
      actor
    );
    const ifMatch: IfMatchCondition = {
      any: false,
      versions: [flag.version]
    };

    await flags.update(
      flag.id,
      { enabled: true },
      { ifMatch, ability: SYSTEM_ABILITY, actor }
    );
    await roleService.update(
      role.id,
      { name: `${tag}-flagged-renamed` },
      { ability: SYSTEM_ABILITY }
    );
    await roleService.delete(role.id, { ability: SYSTEM_ABILITY });
    await flags.delete(flag.id, SYSTEM_ABILITY, actor);
  }, 60000);

  it('deletes the regional rows of missing settings rows in the transaction of the apply', async () => {
    const live = await roleService.create(
      { name: `${tag}-live` },
      { ability: SYSTEM_ABILITY }
    );
    const [goneRole, goneRule] = [randomUUID(), randomUUID()];

    await dataSource.query(
      'INSERT INTO "user_roles" ("user_id", "role_id") VALUES ($1, $2), ($1, $3)',
      [user.id, live.id, goneRole]
    );
    await dataSource.query(
      'INSERT INTO "feature_flag_rule_users" ("rule_id", "user_id") VALUES ($1, $2)',
      [goneRule, user.id]
    );
    // The apply holds its regional transaction and reads the settings rows
    // through the settings pool, one statement at a time.
    await dataSource.transaction(async (regional) => {
      const managers = { regional, settings: settingsDataSource.manager };

      await deleteOrphanRows(managers, 'roleMembers');
      await deleteOrphanRows(managers, 'ruleMembers');
    });

    const roles = await dataSource.query<Array<{ role_id: string }>>(
      'SELECT "role_id" FROM "user_roles" WHERE "user_id" = $1',
      [user.id]
    );
    const members = await dataSource.query<unknown[]>(
      'SELECT 1 FROM "feature_flag_rule_users" WHERE "rule_id" = $1',
      [goneRule]
    );

    expect(roles.map(({ role_id: id }) => id)).toEqual([live.id]);
    expect(members).toEqual([]);
    await roleService.delete(live.id, { ability: SYSTEM_ABILITY });
  }, 60000);

  it('updates and restores a resource', async () => {
    const resources = app.get(ResourceService);
    const registry = app.get(ResourceRegistryService);
    const resource = await settingsDataSource.getRepository(Resource).save({
      name: `${tag}-resource`,
      subject: `PoolOne${tag.replaceAll('-', '')}`,
      displayName: 'Pool probe',
      isOrphaned: true
    });
    const registered = (
      await settingsDataSource.getRepository(Resource).find()
    ).filter(({ isOrphaned }) => !isOrphaned);

    jest
      .spyOn(registry, 'isRegistered')
      .mockImplementation(
        (name) =>
          name === resource.name || registered.some((r) => r.name === name)
      );
    await resources.restore(resource.id, { ability: SYSTEM_ABILITY });
    await resources.update(
      resource.id,
      { displayName: 'Pool probe renamed' },
      { ability: SYSTEM_ABILITY }
    );
  }, 60000);
});
