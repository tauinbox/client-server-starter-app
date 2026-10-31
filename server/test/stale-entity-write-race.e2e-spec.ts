import { INestApplication, VersioningType } from '@nestjs/common';
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
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
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
      SYSTEM_ABILITY
    );
    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    await roleService.assignRoleToUser(admin.id, superRole.id, SYSTEM_ABILITY);
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
    let markArrived: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      markArrived = resolve;
    });
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
      SYSTEM_ABILITY
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
        SYSTEM_ABILITY
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
    await usersService.setPasswordResetToken(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + 60 * 60 * 1000)
    );
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

  it('reports a user delete once and writes one audit row', async () => {
    const user = await createUser('twice');
    const barrier = holdTwoTransactions();

    const remove = () =>
      request(http())
        .delete(`/api/v1/users/${user.id}`)
        .auth(token, { type: 'bearer' });
    const responses = await Promise.all([remove(), remove()]);

    expect(barrier.held()).toBe(2);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 404]);
    const loser = responses.find((r) => r.status === 404);
    expect(loser && errorKey(loser)).toBe(ErrorKeys.USERS.NOT_FOUND);
    expect(await auditRows(AuditAction.USER_DELETE, user.id)).toBe(1);
  }, 30000);
});
