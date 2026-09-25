// A sign-in makes the browser overwrite its refresh cookie, so the session
// behind the old value must end with it. Only the provider guard is stubbed.

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import { Server } from 'http';
import { DataSource, In } from 'typeorm';
import { requiresSecureCookies } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-oauth.guard';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { User } from '../src/modules/users/entities/user.entity';
import type { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';
import { withPrivateThrottlerStorage } from './private-throttler';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('A sign-in ends the session of the presented cookie (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  let refreshCookieName: string;
  let currentProfile: OAuthUserProfile;
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const ownerEmail = `relogin-owner-${stamp}@example.com`;
  const otherEmail = `relogin-other-${stamp}@example.com`;
  const oauthEmail = `relogin-oauth-${stamp}@example.com`;
  const password = 'Lantern-Orchard-47';

  const stubGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
      context.switchToHttp().getRequest<{ user: OAuthUserProfile }>().user =
        currentProfile;
      return true;
    }
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    )
      .overrideGuard(GoogleOAuthGuard)
      .useValue(stubGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
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
    authService = app.get(AuthService);
    usersService = app.get(UsersService);
    refreshCookieName = requiresSecureCookies(
      app.get(ConfigService).get<string>('ENVIRONMENT')
    )
      ? '__Host-refresh_token'
      : 'refresh_token';

    for (const email of [ownerEmail, otherEmail]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Relogin', lastName: 'Owner' })
        .expect(201);
    }
    await dataSource
      .getRepository(User)
      .update(
        { email: In([ownerEmail, otherEmail]) },
        { isEmailVerified: true }
      );
  }, 60000);

  afterAll(async () => {
    const users = await dataSource
      ?.getRepository(User)
      .find({ where: { email: In([ownerEmail, otherEmail, oauthEmail]) } });
    const ids = users?.map((u) => u.id) ?? [];
    if (ids.length) {
      await dataSource.getRepository(AuditLog).delete({ actorId: In(ids) });
      // refresh_tokens.user_id and oauth_accounts.user_id cascade on delete.
      await dataSource.getRepository(User).delete({ id: In(ids) });
    }
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  /** The `name=value` pair a response set, ready to send back. */
  function cookieOf(res: request.Response, name: string): string {
    const header = res.headers['set-cookie'] as string[] | string | undefined;
    const lines = Array.isArray(header) ? header : [header ?? ''];
    const line = lines.find((l) => l.startsWith(`${name}=`));
    if (!line) throw new Error(`the response set no ${name} cookie`);
    return line.split(';')[0];
  }

  /**
   * Mints a session without the login route, which allows 3 requests a
   * minute, and returns its cookie as the browser would send it.
   */
  async function sessionCookieOf(email: string): Promise<string> {
    const { id } = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email });
    const { tokens } = await authService.login(
      await usersService.findOne(id),
      'Previous-Device'
    );
    return `${refreshCookieName}=${tokens.refresh_token}`;
  }

  async function signIn(email: string, presented?: string): Promise<string> {
    const req = request(http()).post('/api/v1/auth/login');
    if (presented) void req.set('Cookie', presented);
    const res = await req.send({ email, password }).expect(200);
    return cookieOf(res, refreshCookieName);
  }

  async function refreshStatus(cookie: string): Promise<number> {
    const res = await request(http())
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', cookie);
    return res.status;
  }

  async function liveRowsOf(email: string): Promise<number> {
    const [{ count }] = await dataSource.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE u.email = $1 AND rt.revoked = false`,
      [email]
    );
    return count;
  }

  it('a second password sign-in ends the session the browser replaces', async () => {
    const first = await signIn(ownerEmail);
    const second = await signIn(ownerEmail, first);

    expect(await liveRowsOf(ownerEmail)).toBe(1);
    expect(await refreshStatus(first)).toBe(401);
    expect(await refreshStatus(second)).toBe(200);
  }, 30000);

  it('a password sign-in to another account ends the replaced session too', async () => {
    const presented = await sessionCookieOf(ownerEmail);
    const ownerRowsBefore = await liveRowsOf(ownerEmail);

    await signIn(otherEmail, presented);

    expect(await liveRowsOf(ownerEmail)).toBe(ownerRowsBefore - 1);
    expect(await refreshStatus(presented)).toBe(401);
  }, 30000);

  it('the provider exchange ends the session the browser replaces', async () => {
    const presented = await sessionCookieOf(ownerEmail);
    currentProfile = {
      provider: 'google',
      providerId: `google-${stamp}`,
      email: oauthEmail,
      firstName: 'Relogin',
      lastName: 'Provider',
      emailVerified: true
    };
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: oauthEmail,
        firstName: 'Relogin',
        lastName: 'Provider',
        password: null,
        isEmailVerified: true
      })
    );
    await dataSource.getRepository(OAuthAccount).save({
      userId: user.id,
      provider: 'google',
      providerId: currentProfile.providerId
    });

    const callback = await request(http())
      .get('/api/v1/auth/oauth/google/callback')
      .expect(302);
    const oauthData = cookieOf(
      callback,
      refreshCookieName.replace('refresh_token', 'oauth_data')
    );

    const exchange = await request(http())
      .post('/api/v1/auth/oauth/exchange')
      .set('Cookie', [oauthData, presented])
      .expect(201);

    expect(await refreshStatus(presented)).toBe(401);
    expect(await refreshStatus(cookieOf(exchange, refreshCookieName))).toBe(
      200
    );
  }, 30000);
});
