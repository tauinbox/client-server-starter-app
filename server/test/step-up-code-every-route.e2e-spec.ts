import { VersioningType } from '@nestjs/common';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import type { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { generateSync } from 'otplib';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { SecretEncryptionService } from '../src/common/crypto/secret-encryption.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { withPrivateThrottlerStorage } from './private-throttler';

// An account created through a provider holds no password. When it carries an
// authenticator, a code is a step-up factor on every step-up route, so none of
// these changes needs a provider round trip.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const WRONG_CODE = '000000';

runWithInfra('A code is a step-up factor on every step-up route (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const previousKey = process.env['MFA_ENCRYPTION_KEY'];
  const stamp = Date.now();
  const email = `step-up-code-${stamp}@example.com`;
  let id: string;

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

    // Registration gives the account the default role; the password is then
    // removed, as an account created through a provider holds none.
    await request(http())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Lantern-Orchard-47',
        name: 'Step Up'
      })
      .expect(201);
    id = (
      await dataSource.getRepository(User).findOneOrFail({ where: { email } })
    ).id;
    await dataSource.getRepository(User).update(id, {
      password: null,
      isEmailVerified: true,
      totpSecret: app.get(SecretEncryptionService).encrypt(SECRET),
      totpEnabledAt: new Date(),
      totpRecoveryCodes: ['spent-hash']
    });
    await dataSource.getRepository(OAuthAccount).save([
      { userId: id, provider: 'google', providerId: `google-${stamp}` },
      { userId: id, provider: 'vk', providerId: `vk-${stamp}` }
    ]);
  }, 60000);

  afterAll(async () => {
    if (previousKey === undefined) delete process.env['MFA_ENCRYPTION_KEY'];
    else process.env['MFA_ENCRYPTION_KEY'] = previousKey;
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function token(): Promise<string> {
    const user = await usersService.findOne(id, SYSTEM_ABILITY);
    const { tokens } = await authService.login(user, {
      userAgent: 'step-up-code-e2e',
      ipAddress: null
    });
    return tokens.access_token;
  }

  // A code is single use, so each step-up gets a fresh one.
  async function freshCode(): Promise<string> {
    await dataSource.getRepository(User).update(id, { totpLastUsedStep: null });
    return generateSync({ secret: SECRET });
  }

  function row(): Promise<User> {
    return dataSource.getRepository(User).findOneOrFail({ where: { id } });
  }

  const routes: ReadonlyArray<
    [
      name: string,
      method: 'post' | 'delete' | 'patch',
      path: string,
      body: object,
      applied: () => Promise<void>
    ]
  > = [
    [
      'an email change',
      'post',
      '/api/v1/auth/profile/email/initiate',
      { newEmail: `step-up-code-new-${stamp}@example.com` },
      async () => {
        expect((await row()).pendingEmail).toBe(
          `step-up-code-new-${stamp}@example.com`
        );
      }
    ],
    [
      'a provider link',
      'post',
      '/api/v1/auth/oauth/link-init',
      {},
      () => Promise.resolve()
    ],
    [
      'a provider unlink',
      'delete',
      '/api/v1/auth/oauth/accounts/vk',
      {},
      async () => {
        const providers = await dataSource
          .getRepository(OAuthAccount)
          .find({ where: { userId: id } });
        expect(providers.map((p) => p.provider)).toEqual(['google']);
      }
    ],
    [
      'a first password',
      'patch',
      '/api/v1/auth/profile',
      { password: 'Quarry-Bramble-83' },
      async () => {
        expect((await row()).password).not.toBeNull();
      }
    ]
  ];

  it.each(routes)(
    'authorises %s with a code and no provider proof',
    async (_name, method, path, body, applied) => {
      const bearer = await token();

      const refused = await request(http())
        [method](path)
        .auth(bearer, { type: 'bearer' })
        .send(body);
      expect(refused.status).toBe(403);
      expect((refused.body as { errorKey?: string }).errorKey).toBe(
        ErrorKeys.AUTH.REAUTH_REQUIRED
      );

      // The refusal names the factor the caller offered, not the provider.
      const wrongCode = await request(http())
        [method](path)
        .auth(bearer, { type: 'bearer' })
        .send({ ...body, code: WRONG_CODE });
      expect(wrongCode.status).toBe(403);
      expect((wrongCode.body as { errorKey?: string }).errorKey).toBe(
        ErrorKeys.AUTH.MFA_STEP_UP_INVALID_CODE
      );

      const accepted = await request(http())
        [method](path)
        .auth(bearer, { type: 'bearer' })
        .send({ ...body, code: await freshCode() });
      expect(accepted.status).toBeLessThan(300);
      await applied();
    },
    30000
  );

  // The mock refuses the same body with the same message.
  it('refuses a field the step-up body does not declare', async () => {
    const refused = await request(http())
      .post('/api/v1/auth/oauth/link-init')
      .auth(await token(), { type: 'bearer' })
      .send({ extra: 1 });

    expect(refused.status).toBe(422);
    expect((refused.body as { message?: string }).message).toBe(
      'property extra should not exist'
    );
  }, 30000);

  // Runs after the first password: ASVS 6.2.3 asks for the current password
  // once the account holds one, and a code does not stand in for it.
  it('refuses a code in place of the current password', async () => {
    const before = (await row()).password;

    const refused = await request(http())
      .patch('/api/v1/auth/profile')
      .auth(await token(), { type: 'bearer' })
      .send({ password: 'Harbor-Lantern-61', code: await freshCode() });

    expect(refused.status).toBe(403);
    expect((refused.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    );
    expect((await row()).password).toBe(before);
  }, 30000);

  // Runs after the first password, so the account now holds one.
  it('names the code, not the password, when only a wrong code is offered', async () => {
    const refused = await request(http())
      .post('/api/v1/auth/mfa/disable')
      .auth(await token(), { type: 'bearer' })
      .send({ code: WRONG_CODE });

    expect(refused.status).toBe(403);
    expect((refused.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.MFA_STEP_UP_INVALID_CODE
    );
    expect((await row()).totpEnabledAt).not.toBeNull();
  }, 30000);
});
