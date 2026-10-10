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
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { withPrivateThrottlerStorage } from './private-throttler';

// A rule on the wire is FeatureFlagRuleResponse: the rule type is in
// payload.type only. The mock pins the same keys:
// feature-flag-validation-parity.spec.ts.
// CI runs the migrations and not the seeders; the super role comes from them.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const RULE_KEYS = [
  'createdAt',
  'effect',
  'flagId',
  'id',
  'payload',
  'updatedAt'
];

runWithInfra('Feature flag rule response shape (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const stamp = Date.now();
  const adminEmail = `flag-rule-shape-${stamp}@example.com`;
  const flagKey = `flag-rule-shape-${stamp}`;
  const password = 'Lantern-Orchard-47';
  const roleRule = {
    effect: 'include',
    payload: { type: 'role', roleNames: ['beta'] }
  };

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
      .send({
        email: adminEmail,
        password,
        firstName: 'Rule',
        lastName: 'Shape'
      })
      .expect(201);
    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    const admin = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email: adminEmail } });
    await app.get(RoleService).assignRoleToUser(admin.id, superRole.id);
    const { tokens } = await app
      .get(AuthService)
      .login(await app.get(UsersService).findOne(admin.id), {
        userAgent: 'flag-rule-shape-e2e',
        ipAddress: null
      });
    token = tokens.access_token;
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(FeatureFlag)
      .delete([{ key: flagKey }, { key: `${flagKey}-typed` }]);
    await dataSource?.getRepository(User).delete({ email: adminEmail });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  type FlagBody = { id: string; rules: { payload: unknown }[] };

  it('answers the rule without a rule-level type on create and read', async () => {
    const created = await request(http())
      .post('/api/v1/admin/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: flagKey, rules: [roleRule] })
      .expect(201);
    const createdBody = created.body as FlagBody;
    expect(Object.keys(createdBody.rules[0]).sort()).toEqual(RULE_KEYS);
    expect(createdBody.rules[0].payload).toEqual(roleRule.payload);

    const read = await request(http())
      .get(`/api/v1/admin/feature-flags/${createdBody.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Object.keys((read.body as FlagBody).rules[0]).sort()).toEqual(
      RULE_KEYS
    );
  });

  it('rejects a rule that still sends a rule-level type', async () => {
    const res = await request(http())
      .post('/api/v1/admin/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: `${flagKey}-typed`, rules: [{ ...roleRule, type: 'role' }] })
      .expect(400);
    expect(res.body).toMatchObject({
      message: 'rules.0.property type should not exist',
      errors: ['rules.0.property type should not exist']
    });
  });
});
