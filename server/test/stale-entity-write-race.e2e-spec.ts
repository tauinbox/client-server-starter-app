import {
  HttpException,
  INestApplication,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { hashToken } from '../src/common/utils/hash-token';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { ResourceRegistryService } from '../src/modules/auth/services/resource-registry.service';
import { ResourceService } from '../src/modules/auth/services/resource.service';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagRule } from '../src/modules/feature-flags/entities/feature-flag-rule.entity';
import {
  createMongoAbility,
  SYSTEM_ABILITY,
  type AppAbility
} from '../src/modules/auth/casl/app-ability';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// A write that loaded its row before a concurrent request changed it must not
// put the old values back. The first request is held in front of its write
// transaction until the second request has answered.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Writes of a loaded entity under a race (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let roleService: RoleService;
  let usersService: UsersService;
  let token: string;
  const stamp = Date.now();
  const prefix = `stale-write-${stamp}`;
  const adminEmail = `${prefix}-admin@example.com`;
  const password = 'Lantern-Orchard-47';

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    const expressApp = moduleRef.createNestApplication<NestExpressApplication>(
      HTTP_BODY_APP_OPTIONS
    );
    applyBodyParsers(expressApp);
    app = expressApp;
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    roleService = app.get(RoleService);
    usersService = app.get(UsersService);

    const admin = await usersService.create(
      { email: adminEmail, password, name: 'Stale Write' },
      { ability: SYSTEM_ABILITY }
    );
    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    await roleService.assignRoleToUser(admin.id, superRole.id, {
      ability: SYSTEM_ABILITY
    });
    const { tokens } = await app
      .get(AuthService)
      .login(await usersService.findOne(admin.id, SYSTEM_ABILITY), {
        userAgent: 'stale-write-e2e',
        ipAddress: null
      });
    token = tokens.access_token;
  }, 60000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(FeatureFlag)
        .where('key LIKE :prefix', { prefix: `${prefix}%` })
        .execute();
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(Role)
        .where('name LIKE :prefix', { prefix: `${prefix}%` })
        .execute();
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(Resource)
        .where('name LIKE :prefix', { prefix: `${prefix}%` })
        .execute();
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(User)
        .where('email LIKE :prefix', { prefix: `${prefix}%` })
        .execute();
    }
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  /**
   * Holds the first transaction that starts after the call until `release`.
   * `arrived` resolves when that transaction is held.
   */
  function holdFirstTransaction(): {
    arrived: Promise<void>;
    release: () => void;
  } {
    let held = false;
    let release: () => void = () => undefined;
    const { promise: arrived, resolve: markArrived } =
      Promise.withResolvers<void>();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
      setTimeout(resolve, 10000).unref();
    });
    const original = EntityManager.prototype.transaction;
    jest
      .spyOn(EntityManager.prototype, 'transaction')
      .mockImplementation(async function (
        this: EntityManager,
        ...args: Parameters<EntityManager['transaction']>
      ) {
        if (!held) {
          held = true;
          markArrived();
          await gate;
        }
        return original.apply(this, args);
      });
    return { arrived, release };
  }

  /** Holds the first two transactions until both have arrived. */
  function holdTwoTransactions(): { held: () => number } {
    let held = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
      setTimeout(resolve, 5000).unref();
    });
    const original = EntityManager.prototype.transaction;
    jest
      .spyOn(EntityManager.prototype, 'transaction')
      .mockImplementation(async function (
        this: EntityManager,
        ...args: Parameters<EntityManager['transaction']>
      ) {
        if (held < 2) {
          held += 1;
          if (held === 2) release();
          await gate;
        }
        return original.apply(this, args);
      });
    return { held: () => held };
  }

  function auditRows(action: AuditAction, targetId: string): Promise<number> {
    return dataSource.getRepository(AuditLog).countBy({ action, targetId });
  }

  function errorKey(res: request.Response): string | undefined {
    return (res.body as { errorKey?: string }).errorKey;
  }

  async function createUser(label: string): Promise<User> {
    return usersService.create(
      {
        email: `${prefix}-${label}@example.com`,
        password,
        name: `Target ${label}`
      },
      { ability: SYSTEM_ABILITY }
    );
  }

  it.each([
    ['description', { description: 'changed' }],
    ['rename', { name: `${prefix}-renamed` }]
  ])(
    'answers a role %s that loses to a delete with the not-found key',
    async (label, body) => {
      const role = await roleService.create(
        { name: `${prefix}-${label}` },
        { ability: SYSTEM_ABILITY }
      );
      const barrier = holdFirstTransaction();

      const patch = request(http())
        .patch(`/api/v1/roles/${role.id}`)
        .auth(token, { type: 'bearer' })
        .send(body)
        .then((r) => r);
      await barrier.arrived;
      const removed = await request(http())
        .delete(`/api/v1/roles/${role.id}`)
        .auth(token, { type: 'bearer' });
      barrier.release();
      const patched = await patch;

      expect(removed.status).toBe(200);
      expect(patched.status).toBe(404);
      expect(errorKey(patched)).toBe(ErrorKeys.ROLES.NOT_FOUND);
      expect(
        await dataSource.getRepository(Role).countBy({ id: role.id })
      ).toBe(0);
      expect(await auditRows(AuditAction.ROLE_UPDATE, role.id)).toBe(0);
    },
    30000
  );

  it('keeps a resource restore that lands before an edit of it', async () => {
    const resources = dataSource.getRepository(Resource);
    const resource = await resources.save(
      resources.create({
        name: `${prefix}-resource`,
        subject: `StaleWrite${stamp}`,
        displayName: 'Stale write',
        description: null,
        isSystem: false,
        actionNames: ['read'],
        conditionalActionNames: [],
        isOrphaned: true
      })
    );
    jest
      .spyOn(app.get(ResourceRegistryService), 'isRegistered')
      .mockReturnValue(true);
    const barrier = holdFirstTransaction();

    const patch = request(http())
      .patch(`/api/v1/rbac/resources/${resource.id}`)
      .auth(token, { type: 'bearer' })
      .send({ description: 'changed' })
      .then((r) => r);
    await barrier.arrived;
    const restored = await request(http())
      .post(`/api/v1/rbac/resources/${resource.id}/restore`)
      .auth(token, { type: 'bearer' });
    barrier.release();
    const patched = await patch;

    expect(restored.status).toBe(200);
    expect(patched.status).toBe(200);
    expect(await resources.findOneByOrFail({ id: resource.id })).toMatchObject({
      isOrphaned: false,
      description: 'changed'
    });
  }, 30000);

  it('keeps a password reset that lands before an administrator edit', async () => {
    const user = await createUser('reset');
    const rawToken = `${prefix}-reset-token`;
    await usersService.setPasswordResetToken(user.id, {
      email: user.email,
      hashedToken: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    const barrier = holdFirstTransaction();

    const patch = request(http())
      .patch(`/api/v1/users/${user.id}`)
      .auth(token, { type: 'bearer' })
      .send({ name: 'Renamed Target' })
      .then((r) => r);
    await barrier.arrived;
    const reset = await request(http())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'Copper-Harbor-93' });
    const afterReset = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    barrier.release();
    const patched = await patch;

    expect(reset.status).toBe(200);
    expect(patched.status).toBe(200);
    const after = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(after.password).toBe(afterReset.password);
    expect(after.password).not.toBe(user.password);
    expect(after.isEmailVerified).toBe(true);
    expect(after.name).toBe('Renamed Target');
  }, 30000);

  it('answers an administrator edit that loses to a delete with the not-found key', async () => {
    const user = await createUser('deleted');
    const barrier = holdFirstTransaction();

    const patch = request(http())
      .patch(`/api/v1/users/${user.id}`)
      .auth(token, { type: 'bearer' })
      .send({ name: 'Renamed Target' })
      .then((r) => r);
    await barrier.arrived;
    const removed = await request(http())
      .delete(`/api/v1/users/${user.id}`)
      .auth(token, { type: 'bearer' });
    barrier.release();
    const patched = await patch;

    expect(removed.status).toBe(200);
    expect(patched.status).toBe(404);
    expect(errorKey(patched)).toBe(ErrorKeys.USERS.NOT_FOUND);
    const after = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { id: user.id }, withDeleted: true });
    expect(after.deletedAt).not.toBeNull();
    expect(after.name).toBe('Target deleted');
    expect(await auditRows(AuditAction.USER_UPDATE, user.id)).toBe(0);
  }, 30000);

  /** The status and key of a refused call, or `RESOLVED`. */
  async function outcome(run: Promise<unknown>): Promise<string> {
    try {
      await run;
      return 'RESOLVED';
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse() as { errorKey?: string };
        return `${error.getStatus()} ${body.errorKey ?? ''}`.trim();
      }
      throw error;
    }
  }

  // Each case below holds a write of a delegated caller in front of its
  // transaction, after its early check passed, while a concurrent change
  // moves the record out of the rights of the caller.
  describe('the instance check of a delegated caller', () => {
    const scopedUserUpdate = { action: 'update', subject: 'User' } as const;
    const activeOnly = { conditions: { isActive: true } };

    it('refuses a non-super resource edit that read the row before a super narrowed it', async () => {
      const resources = dataSource.getRepository(Resource);
      const resource = await resources.save(
        resources.create({
          name: `${prefix}-widen`,
          subject: `StaleWiden${stamp}`,
          displayName: 'Stale widen',
          description: null,
          isSystem: false,
          actionNames: ['read', 'delete'],
          conditionalActionNames: [],
          allowedActionNames: null
        })
      );
      const delegate = createMongoAbility<AppAbility>([
        { action: 'update', subject: 'Permission' }
      ]);
      const superAbility = createMongoAbility<AppAbility>([
        { action: 'manage', subject: 'all' }
      ]);
      const resourceService = app.get(ResourceService);
      const barrier = holdFirstTransaction();

      const edit = outcome(
        resourceService.update(
          resource.id,
          { allowedActionNames: ['read', 'delete'] },
          { ability: delegate }
        )
      );
      await barrier.arrived;
      await resourceService.update(
        resource.id,
        { allowedActionNames: ['read'] },
        { ability: superAbility }
      );
      barrier.release();

      expect(await edit).toBe(`403 ${ErrorKeys.RESOURCES.CANNOT_WIDEN}`);
      expect(
        (await resources.findOneByOrFail({ id: resource.id }))
          .allowedActionNames
      ).toEqual(['read']);
    }, 30000);

    it('refuses a scoped user edit that read the row before a deactivation', async () => {
      const user = await createUser('scoped-edit');
      const delegate = createMongoAbility<AppAbility>([
        { ...scopedUserUpdate, ...activeOnly }
      ]);
      const barrier = holdFirstTransaction();

      const edit = outcome(
        usersService.update(user.id, { name: 'After' }, { ability: delegate })
      );
      await barrier.arrived;
      await usersService.update(
        user.id,
        { isActive: false },
        { ability: SYSTEM_ABILITY }
      );
      barrier.release();

      expect(await edit).toBe(
        `403 ${ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS}`
      );
      const after = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(after.name).toBe('Target scoped-edit');
      expect(after.isActive).toBe(false);
    }, 30000);

    it('refuses a role assignment whose target left the scope before the lock', async () => {
      const user = await createUser('scoped-assign');
      const role = await roleService.create(
        { name: `${prefix}-assign` },
        { ability: SYSTEM_ABILITY }
      );
      const delegate = createMongoAbility<AppAbility>([
        { ...scopedUserUpdate, ...activeOnly },
        { action: 'assign', subject: 'Role' }
      ]);
      const barrier = holdFirstTransaction();

      const assign = outcome(
        roleService.assignRoleToUser(user.id, role.id, { ability: delegate })
      );
      await barrier.arrived;
      await usersService.update(
        user.id,
        { isActive: false },
        { ability: SYSTEM_ABILITY }
      );
      barrier.release();

      expect(await assign).toBe(
        `403 ${ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS}`
      );
      const after = await dataSource.getRepository(User).findOneOrFail({
        where: { id: user.id },
        relations: { roles: true }
      });
      expect(after.roles.map((r) => r.id)).not.toContain(role.id);
    }, 30000);
  });

  // The listeners of a role event rewrite the flag rules by the old name, so
  // the event must carry the name of the row that the write changed.
  describe('the role name of a role event', () => {
    async function flagOnRole(label: string, roleName: string) {
      return app.get(FeatureFlagService).create(
        {
          key: `${prefix}-${label}`,
          rules: [
            {
              effect: 'include',
              payload: { type: 'role', roleNames: [roleName] }
            }
          ]
        },
        SYSTEM_ABILITY,
        { actorId: null, actorEmail: null, context: {} }
      );
    }

    async function ruleRoleNames(flagId: string): Promise<string[]> {
      const [rule] = await dataSource
        .getRepository(FeatureFlagRule)
        .findBy({ flagId });
      return (rule.payload as { roleNames: string[] }).roleNames;
    }

    it('rewrites the rules by the name that a concurrent rename committed', async () => {
      const role = await roleService.create(
        { name: `${prefix}-rename-a` },
        { ability: SYSTEM_ABILITY }
      );
      const flag = await flagOnRole('rename', role.name);
      const barrier = holdFirstTransaction();

      const last = roleService.update(
        role.id,
        { name: `${prefix}-rename-c` },
        { ability: SYSTEM_ABILITY }
      );
      await barrier.arrived;
      await roleService.update(
        role.id,
        { name: `${prefix}-rename-b` },
        { ability: SYSTEM_ABILITY }
      );
      barrier.release();
      await last;

      expect(await ruleRoleNames(flag.id)).toEqual([`${prefix}-rename-c`]);
    }, 30000);

    it('drops the name that a concurrent rename committed from the rules on delete', async () => {
      const role = await roleService.create(
        { name: `${prefix}-delete-a` },
        { ability: SYSTEM_ABILITY }
      );
      const flag = await flagOnRole('delete', role.name);
      const barrier = holdFirstTransaction();

      const removal = roleService.delete(role.id, { ability: SYSTEM_ABILITY });
      await barrier.arrived;
      await roleService.update(
        role.id,
        { name: `${prefix}-delete-b` },
        { ability: SYSTEM_ABILITY }
      );
      barrier.release();
      await removal;

      expect(await ruleRoleNames(flag.id)).toEqual([]);
    }, 30000);
  });

  it('reports a user delete once and writes one audit row', async () => {
    const user = await createUser('twice');
    const barrier = holdTwoTransactions();

    const remove = () =>
      request(http())
        .delete(`/api/v1/users/${user.id}`)
        .auth(token, { type: 'bearer' });
    const responses = await Promise.all([remove(), remove()]);

    expect(barrier.held()).toBe(2);
    expect(responses.map((r) => r.status).toSorted()).toEqual([200, 404]);
    const loser = responses.find((r) => r.status === 404);
    expect(loser && errorKey(loser)).toBe(ErrorKeys.USERS.NOT_FOUND);
    expect(await auditRows(AuditAction.USER_DELETE, user.id)).toBe(1);
  }, 30000);
});
