import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// A flag change and its audit row commit together: when the row cannot be
// written, the request fails and the flag table keeps its previous state.
// CI runs the migrations and not the seeders; the super role comes from them.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Feature flag audit in the write transaction (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let flag: FeatureFlag;
  const stamp = Date.now();
  const adminEmail = `flag-audit-tx-admin-${stamp}@example.com`;
  const flagKey = `flag-audit-tx-${stamp}`;
  const createdKey = `flag-audit-tx-new-${stamp}`;
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
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);

    await request(http())
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password, firstName: 'Flag', lastName: 'Tx' })
      .expect(201);
    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    const adminId = (
      await dataSource
        .getRepository(User)
        .findOneOrFail({ where: { email: adminEmail } })
    ).id;
    await app.get(RoleService).assignRoleToUser(adminId, superRole.id);
    const { tokens } = await app
      .get(AuthService)
      .login(await app.get(UsersService).findOne(adminId), {
        userAgent: 'flag-audit-tx-e2e',
        ipAddress: null
      });
    token = tokens.access_token;

    const created = await request(http())
      .post('/api/v1/admin/feature-flags')
      .auth(token, { type: 'bearer' })
      .send({ key: flagKey, description: 'before' })
      .expect(201);
    flag = created.body as FeatureFlag;
  }, 60000);

  beforeEach(() => {
    jest
      .spyOn(app.get(AuditService), 'log')
      .mockRejectedValue(new Error('audit down'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dataSource
      ?.getRepository(FeatureFlag)
      .delete([{ key: flagKey }, { key: createdKey }]);
    await dataSource?.getRepository(User).delete({ email: adminEmail });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  function storedFlag(key: string): Promise<FeatureFlag | null> {
    return dataSource.getRepository(FeatureFlag).findOneBy({ key });
  }

  it('create answers 500 and stores no flag', async () => {
    await request(http())
      .post('/api/v1/admin/feature-flags')
      .auth(token, { type: 'bearer' })
      .send({ key: createdKey })
      .expect(500);

    expect(await storedFlag(createdKey)).toBeNull();
  });

  it('update answers 500 and keeps the stored flag', async () => {
    await request(http())
      .patch(`/api/v1/admin/feature-flags/${flag.id}`)
      .auth(token, { type: 'bearer' })
      .set('If-Match', String(flag.version))
      .send({ description: 'after' })
      .expect(500);

    expect(await storedFlag(flagKey)).toMatchObject({
      description: 'before',
      version: flag.version
    });
  });

  it('delete answers 500 and keeps the flag', async () => {
    await request(http())
      .delete(`/api/v1/admin/feature-flags/${flag.id}`)
      .auth(token, { type: 'bearer' })
      .expect(500);

    expect(await storedFlag(flagKey)).not.toBeNull();
  });

  it('delete with a working audit removes the flag and writes its row', async () => {
    jest.restoreAllMocks();

    await request(http())
      .delete(`/api/v1/admin/feature-flags/${flag.id}`)
      .auth(token, { type: 'bearer' })
      .expect(204);

    expect(await storedFlag(flagKey)).toBeNull();
    const row = await dataSource.getRepository(AuditLog).findOneByOrFail({
      action: AuditAction.FEATURE_FLAG_DELETE,
      targetId: flag.id
    });
    expect(row.details).toEqual({ key: flagKey });
  });
});
