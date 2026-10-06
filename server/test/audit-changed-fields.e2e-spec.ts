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
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { withPrivateThrottlerStorage } from './private-throttler';

// An edit form sends every field on each save, so the audit row must list the
// fields whose stored value changed, not the keys of the request.
// CI runs the migrations and not the seeders; the super role comes from them.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Audit changedFields of the admin edit routes (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const stamp = Date.now();
  const adminEmail = `audit-fields-admin-${stamp}@example.com`;
  const targetEmail = `audit-fields-target-${stamp}@example.com`;
  const roleName = `audit-fields-role-${stamp}`;
  const flagKey = `audit-fields-flag-${stamp}`;
  const password = 'Lantern-Orchard-47';
  let resourceRestore: Pick<Resource, 'id' | 'description'> | undefined;

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

    for (const email of [adminEmail, targetEmail]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Audit', lastName: 'Fields' })
        .expect(201);
    }
    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    const usersService = app.get(UsersService);
    const adminId = await userId(adminEmail);
    await app.get(RoleService).assignRoleToUser(adminId, superRole.id);
    const { tokens } = await app
      .get(AuthService)
      .login(await usersService.findOne(adminId), {
        userAgent: 'audit-fields-e2e',
        ipAddress: null
      });
    token = tokens.access_token;
  }, 60000);

  afterAll(async () => {
    if (resourceRestore) {
      await dataSource?.getRepository(Resource).update(resourceRestore.id, {
        description: resourceRestore.description
      });
    }
    await dataSource?.getRepository(FeatureFlag).delete({ key: flagKey });
    await dataSource?.getRepository(Role).delete({ name: roleName });
    await dataSource
      ?.getRepository(User)
      .delete([{ email: adminEmail }, { email: targetEmail }]);
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function userId(email: string): Promise<string> {
    const found = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    return found.id;
  }

  async function lastChangedFields(
    action: AuditAction,
    targetId: string
  ): Promise<unknown> {
    const row = await dataSource.getRepository(AuditLog).findOneOrFail({
      where: { action, targetId },
      order: { createdAt: 'DESC' }
    });
    return row.details?.['changedFields'];
  }

  function patch(path: string, body: object, ifMatch?: number) {
    const req = request(http())
      .patch(`/api/v1/${path}`)
      .auth(token, { type: 'bearer' });
    if (ifMatch !== undefined) req.set('If-Match', String(ifMatch));
    return req.send(body).expect(200);
  }

  it('feature flag: a resubmit logs [] and a description edit logs ["description"]', async () => {
    const created = await request(http())
      .post('/api/v1/admin/feature-flags')
      .auth(token, { type: 'bearer' })
      .send({ key: flagKey, description: 'old', enabled: true })
      .expect(201);
    const flag = created.body as {
      id: string;
      version: number;
      environments: string[];
      public: boolean;
    };
    const form = {
      description: 'old',
      enabled: true,
      environments: flag.environments,
      public: flag.public
    };

    await patch(`admin/feature-flags/${flag.id}`, form, flag.version);
    expect(
      await lastChangedFields(AuditAction.FEATURE_FLAG_UPDATE, flag.id)
    ).toEqual([]);

    await patch(
      `admin/feature-flags/${flag.id}`,
      { ...form, description: 'new' },
      flag.version + 1
    );
    expect(
      await lastChangedFields(AuditAction.FEATURE_FLAG_UPDATE, flag.id)
    ).toEqual(['description']);
  });

  it('role: a resubmit logs [] and a description edit logs ["description"]', async () => {
    const role = await app
      .get(RoleService)
      .create({ name: roleName, description: 'old' });

    await patch(`roles/${role.id}`, { name: roleName, description: 'old' });
    expect(await lastChangedFields(AuditAction.ROLE_UPDATE, role.id)).toEqual(
      []
    );

    await patch(`roles/${role.id}`, { name: roleName, description: 'new' });
    expect(await lastChangedFields(AuditAction.ROLE_UPDATE, role.id)).toEqual([
      'description'
    ]);
  });

  it('resource: a resubmit logs [] and a description edit logs ["description"]', async () => {
    const resource = await dataSource
      .getRepository(Resource)
      .findOneByOrFail({ name: 'users' });
    resourceRestore = { id: resource.id, description: resource.description };
    const form = {
      displayName: resource.displayName,
      description: resource.description,
      allowedActionNames: resource.allowedActionNames
    };

    await patch(`rbac/resources/${resource.id}`, form);
    expect(
      await lastChangedFields(AuditAction.RESOURCE_UPDATE, resource.id)
    ).toEqual([]);

    await patch(`rbac/resources/${resource.id}`, {
      ...form,
      description: `audit-fields-${stamp}`
    });
    expect(
      await lastChangedFields(AuditAction.RESOURCE_UPDATE, resource.id)
    ).toEqual(['description']);
  });

  it('user: a resubmit logs [] and a name edit logs ["firstName"]', async () => {
    const id = await userId(targetEmail);
    const form = {
      email: targetEmail,
      firstName: 'Audit',
      lastName: 'Fields',
      isActive: true
    };

    await patch(`users/${id}`, form);
    expect(await lastChangedFields(AuditAction.USER_UPDATE, id)).toEqual([]);

    await patch(`users/${id}`, { ...form, firstName: 'Renamed' });
    expect(await lastChangedFields(AuditAction.USER_UPDATE, id)).toEqual([
      'firstName'
    ]);
  });
});
