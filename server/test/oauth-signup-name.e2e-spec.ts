import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
import { GoogleStrategy } from '../src/modules/auth/strategies/google.strategy';
import type { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { createMockConfigService } from '../src/common/testing/config-service.mock';
import { withPrivateThrottlerStorage } from './private-throttler';

// A provider that sends no family name once left an empty last name, and every
// later profile save failed on it. Skips without DB_HOST.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('The name of a provider sign-up (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const emails: string[] = [];

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
  }, 60000);

  afterAll(async () => {
    if (emails.length) {
      await dataSource
        ?.getRepository(User)
        .delete(emails.map((email) => ({ email })));
    }
    await app?.close();
  });

  function googleProfile(
    email: string,
    name: { givenName?: string; familyName?: string }
  ): OAuthUserProfile {
    const strategy = new GoogleStrategy(
      createMockConfigService({
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret'
      })
    );
    let profile: OAuthUserProfile | undefined;
    strategy.validate(
      'access',
      'refresh',
      {
        id: `google-${randomBytes(6).toString('hex')}`,
        emails: [{ value: email, verified: true }],
        name
      },
      (_error, user) => {
        profile = user as OAuthUserProfile;
      }
    );
    if (!profile) throw new Error('the strategy gave no profile');
    return profile;
  }

  async function signUp(profile: OAuthUserProfile): Promise<User> {
    const result = await app.get(OAuthService).loginWithOAuth(profile);
    if ('mfaRequired' in result) throw new Error('unexpected challenge');
    return dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email: profile.email } });
  }

  function uniqueEmail(label: string): string {
    const email = `oauth-name-${label}-${Date.now()}-${randomBytes(3).toString('hex')}@example.com`;
    emails.push(email);
    return email;
  }

  it('keeps a given name with no family name, and the profile can be saved', async () => {
    const user = await signUp(
      googleProfile(uniqueEmail('given'), { givenName: 'Madonna' })
    );
    expect(user.name).toBe('Madonna');

    const { tokens } = await app
      .get(AuthService)
      .login(await app.get(UsersService).findOne(user.id, SYSTEM_ABILITY), {
        userAgent: 'oauth-signup-name-e2e',
        ipAddress: null
      });
    const res = await request(app.getHttpServer() as Server)
      .patch('/api/v1/auth/profile')
      .auth(tokens.access_token, { type: 'bearer' })
      .send({ name: 'Madonna L', locale: 'en' })
      .expect(200);

    expect((res.body as { name: string }).name).toBe('Madonna L');
  }, 60000);

  it('takes the email local part when the provider sends no name', async () => {
    const email = uniqueEmail('none');
    const user = await signUp(googleProfile(email, {}));

    expect(user.name).toBe(email.split('@')[0]);
  }, 60000);
});
