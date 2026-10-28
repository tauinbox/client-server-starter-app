import { VersioningType } from '@nestjs/common';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import type { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { withPrivateThrottlerStorage } from './private-throttler';

// The address is the recovery channel of the password, so the email change
// is gated by the same grant as the other writes of the own profile.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PASSWORD = 'Lantern-Orchard-47';

runWithInfra('The email change needs update:Profile (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const stamp = Date.now();
  const noRoleEmail = `profile-grant-none-${stamp}@example.com`;
  const grantedEmail = `profile-grant-user-${stamp}@example.com`;
  let noRoleId: string;
  let grantedId: string;

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
    authService = app.get(AuthService);
    usersService = app.get(UsersService);

    noRoleId = await register(noRoleEmail);
    grantedId = await register(grantedEmail);
    // An administrator can strip every role from an account; the account then
    // holds no update:Profile grant.
    await dataSource.query('DELETE FROM user_roles WHERE user_id = $1', [
      noRoleId
    ]);
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(User)
      .delete([{ email: noRoleEmail }, { email: grantedEmail }]);
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function register(email: string): Promise<string> {
    await request(http())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, name: 'Profile Grant' })
      .expect(201);
    const user = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    await dataSource
      .getRepository(User)
      .update(user.id, { isEmailVerified: true });
    return user.id;
  }

  async function token(id: string): Promise<string> {
    const user = await usersService.findOne(id, SYSTEM_ABILITY);
    const { tokens } = await authService.login(user, {
      userAgent: 'profile-grant-e2e',
      ipAddress: null
    });
    return tokens.access_token;
  }

  function initiate(accessToken: string, newEmail: string) {
    return request(http())
      .post('/api/v1/auth/profile/email/initiate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ newEmail, currentPassword: PASSWORD });
  }

  it('refuses an account with no update:Profile grant', async () => {
    const res = await initiate(
      await token(noRoleId),
      `profile-grant-moved-${stamp}@example.com`
    );

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      errorKey: ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS
    });
    const row = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { id: noRoleId } });
    expect(row.pendingEmail).toBeNull();
  });

  it('accepts an account that holds the grant', async () => {
    const newEmail = `profile-grant-next-${stamp}@example.com`;

    const res = await initiate(await token(grantedId), newEmail);

    expect(res.status).toBe(200);
    const row = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { id: grantedId } });
    expect(row.pendingEmail).toBe(newEmail);
  });
});
