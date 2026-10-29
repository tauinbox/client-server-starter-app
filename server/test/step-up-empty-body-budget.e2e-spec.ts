import { VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ErrorKeys, MAX_FAILED_ATTEMPTS } from '@app/shared/constants';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { SecretEncryptionService } from '../src/common/crypto/secret-encryption.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { withPrivateThrottlerStorage } from './private-throttler';

// The `login-long-window` budget guards the secrets. An account with no
// password proves itself with a provider proof, so a request with no secret
// must not spend that budget on any step-up route.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('A step-up request with no secret spends no budget (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const stamp = Date.now();
  const actorEmail = `step-up-budget-${stamp}@example.com`;
  const targetEmail = `step-up-budget-target-${stamp}@example.com`;
  let actorId: string;
  let targetId: string;
  const previousKey = process.env['MFA_ENCRYPTION_KEY'];

  beforeAll(async () => {
    process.env['MFA_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');

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
    authService = app.get(AuthService);
    usersService = app.get(UsersService);

    for (const email of [actorEmail, targetEmail]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password: 'Lantern-Orchard-47', name: 'Step Up' })
        .expect(201);
    }
    const users = dataSource.getRepository(User);
    actorId = (await users.findOneByOrFail({ email: actorEmail })).id;
    targetId = (await users.findOneByOrFail({ email: targetEmail })).id;

    // The super role passes the permission check of the admin reset, so the
    // request reaches its step-up.
    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    await app
      .get(RoleService)
      .assignRoleToUser(actorId, superRole.id, SYSTEM_ABILITY);

    // An account created through a provider holds no password.
    await users.update(actorId, { password: null, isEmailVerified: true });
    // The admin reset refuses a target with no second factor before its
    // step-up.
    await users.update(targetId, {
      totpSecret: app
        .get(SecretEncryptionService)
        .encrypt('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'),
      totpEnabledAt: new Date()
    });
    await dataSource.getRepository(OAuthAccount).save([
      { userId: actorId, provider: 'google', providerId: `google-${stamp}` },
      { userId: actorId, provider: 'vk', providerId: `vk-${stamp}` }
    ]);
  }, 60000);

  afterAll(async () => {
    if (previousKey === undefined) delete process.env['MFA_ENCRYPTION_KEY'];
    else process.env['MFA_ENCRYPTION_KEY'] = previousKey;
    await dataSource
      ?.getRepository(User)
      .delete([{ email: actorEmail }, { email: targetEmail }]);
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function token(): Promise<string> {
    const user = await usersService.findOne(actorId, SYSTEM_ABILITY);
    const { tokens } = await authService.login(user, {
      userAgent: 'step-up-budget-e2e',
      ipAddress: null
    });
    return tokens.access_token;
  }

  // Every route whose body is `StepUpFactorsDto` or `MfaSetupDto`.
  const routes: ReadonlyArray<
    [name: string, method: 'post' | 'delete', path: () => string]
  > = [
    ['mfa setup', 'post', () => '/api/v1/auth/mfa/setup'],
    ['mfa disable', 'post', () => '/api/v1/auth/mfa/disable'],
    ['recovery codes', 'post', () => '/api/v1/auth/mfa/recovery-codes'],
    ['admin mfa reset', 'post', () => `/api/v1/users/${targetId}/mfa/reset`],
    ['provider link', 'post', () => '/api/v1/auth/oauth/link-init'],
    ['provider unlink', 'delete', () => '/api/v1/auth/oauth/accounts/vk'],
    ['session revoke', 'delete', () => `/api/v1/auth/sessions/${randomUUID()}`],
    ['other sessions revoke', 'delete', () => '/api/v1/auth/sessions']
  ];

  it.each(routes)(
    '%s refuses every empty body with 403, never 429',
    async (_name, method, path) => {
      const bearer = await token();
      const answers: Array<[number, string | undefined]> = [];

      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        const res = await request(http())
          [method](path())
          .auth(bearer, { type: 'bearer' })
          .send({});
        answers.push([
          res.status,
          (res.body as { errorKey?: string }).errorKey
        ]);
      }

      expect(answers).toEqual(
        Array.from({ length: MAX_FAILED_ATTEMPTS }, () => [
          403,
          ErrorKeys.AUTH.REAUTH_REQUIRED
        ])
      );
    },
    30000
  );
});
