import { INestApplication, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// Both requests read the record, then wait in front of their write
// transactions and go on together, so both writes meet in Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Role and flag writes under a race (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let roleService: RoleService;
  let token: string;
  const stamp = Date.now();
  const prefix = `write-race-${stamp}`;
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
    const usersService = app.get(UsersService);

    const admin = await usersService.create(
      { email: adminEmail, password, name: 'Write Race' },
      SYSTEM_ABILITY
    );
    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    await roleService.assignRoleToUser(admin.id, superRole.id, SYSTEM_ABILITY);
    const { tokens } = await app
      .get(AuthService)
      .login(await usersService.findOne(admin.id, SYSTEM_ABILITY), {
        userAgent: 'write-race-e2e',
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
      await dataSource.getRepository(FeatureFlag).delete({ key: prefix });
      await dataSource.getRepository(User).delete({ email: adminEmail });
    }
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
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

  it('reports a role delete once and writes one audit row', async () => {
    const role = await roleService.create(
      { name: `${prefix}-deleted` },
      SYSTEM_ABILITY
    );
    const barrier = holdTwoTransactions();

    const remove = () =>
      request(http())
        .delete(`/api/v1/roles/${role.id}`)
        .auth(token, { type: 'bearer' });
    const responses = await Promise.all([remove(), remove()]);

    expect(barrier.held()).toBe(2);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 404]);
    const loser = responses.find((r) => r.status === 404);
    expect((loser?.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.ROLES.NOT_FOUND
    );
    expect(await auditRows(AuditAction.ROLE_DELETE, role.id)).toBe(1);
  }, 30000);

  it('reports a flag delete once and writes one audit row', async () => {
    const created = await request(http())
      .post('/api/v1/admin/feature-flags')
      .auth(token, { type: 'bearer' })
      .send({ key: prefix })
      .expect(201);
    const flagId = (created.body as { id: string }).id;
    const barrier = holdTwoTransactions();

    const remove = () =>
      request(http())
        .delete(`/api/v1/admin/feature-flags/${flagId}`)
        .auth(token, { type: 'bearer' });
    const responses = await Promise.all([remove(), remove()]);

    expect(barrier.held()).toBe(2);
    expect(responses.map((r) => r.status).sort()).toEqual([204, 404]);
    const loser = responses.find((r) => r.status === 404);
    expect((loser?.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
    expect(await auditRows(AuditAction.FEATURE_FLAG_DELETE, flagId)).toBe(1);
  }, 30000);

  it('runs two replaces of the grants of one role one after the other', async () => {
    const role = await roleService.create(
      { name: `${prefix}-granted` },
      SYSTEM_ABILITY
    );
    const [permission] = await dataSource
      .getRepository(Permission)
      .find({ take: 1, order: { id: 'ASC' } });
    const barrier = holdTwoTransactions();

    const replace = () =>
      request(http())
        .put(`/api/v1/roles/${role.id}/permissions`)
        .auth(token, { type: 'bearer' })
        .send({ items: [{ permissionId: permission.id }] });
    const responses = await Promise.all([replace(), replace()]);

    expect(barrier.held()).toBe(2);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const grants = await dataSource
      .getRepository(RolePermission)
      .findBy({ roleId: role.id });
    expect(grants.map((g) => g.permissionId)).toEqual([permission.id]);
  }, 30000);
});
