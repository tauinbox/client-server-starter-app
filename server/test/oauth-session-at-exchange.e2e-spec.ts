// A provider sign-in issues its session at the exchange, the one request that
// carries the refresh cookie of the session it replaces. Only the provider
// guard is stubbed.

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
import { DataSource } from 'typeorm';
import { requiresSecureCookies } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-oauth.guard';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { SessionLimitService } from '../src/modules/auth/services/session-limit.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { User } from '../src/modules/users/entities/user.entity';
import type { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';
import { withPrivateThrottlerStorage } from './private-throttler';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra(
  'A provider sign-in issues its session at the exchange (e2e)',
  () => {
    let app: INestApplication;
    let dataSource: DataSource;
    let authService: AuthService;
    let usersService: UsersService;
    let refreshCookieName: string;
    let oauthDataCookieName: string;
    let user: User;
    const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const profile: OAuthUserProfile = {
      provider: 'google',
      providerId: `google-${stamp}`,
      email: `oauth-exchange-${stamp}@example.com`,
      firstName: 'Exchange',
      lastName: 'Owner',
      emailVerified: true
    };

    const stubGuard: CanActivate = {
      canActivate: (context: ExecutionContext): boolean => {
        context.switchToHttp().getRequest<{ user: OAuthUserProfile }>().user =
          profile;
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
      const secure = requiresSecureCookies(
        app.get(ConfigService).get<string>('ENVIRONMENT')
      );
      refreshCookieName = secure ? '__Host-refresh_token' : 'refresh_token';
      oauthDataCookieName = secure ? '__Host-oauth_data' : 'oauth_data';

      user = await dataSource.getRepository(User).save(
        dataSource.getRepository(User).create({
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          password: null,
          isEmailVerified: true
        })
      );
      await dataSource.getRepository(OAuthAccount).save({
        userId: user.id,
        provider: profile.provider,
        providerId: profile.providerId
      });
    }, 60000);

    beforeEach(async () => {
      await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [
        user.id
      ]);
    });

    afterAll(async () => {
      if (user) {
        await dataSource.getRepository(AuditLog).delete({ actorId: user.id });
        // refresh_tokens.user_id and oauth_accounts.user_id cascade on delete.
        await dataSource.getRepository(User).delete({ id: user.id });
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

    /** One session per call, oldest first, as refresh cookies. */
    async function fillQuota(): Promise<string[]> {
      const limit = await app.get(SessionLimitService).maxSessionsFor(user.id);
      const cookies: string[] = [];
      for (let i = 0; i < limit; i++) {
        const { tokens } = await authService.login(
          await usersService.findOne(user.id),
          `Device-${i}`
        );
        cookies.push(`${refreshCookieName}=${tokens.refresh_token}`);
      }
      return cookies;
    }

    async function callback(): Promise<string> {
      const res = await request(http())
        .get('/api/v1/auth/oauth/google/callback')
        .expect(302);
      expect(res.headers['location']).toMatch(/\/oauth\/callback$/);
      return cookieOf(res, oauthDataCookieName);
    }

    async function liveRows(): Promise<number> {
      const [{ count }] = await dataSource.query<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM refresh_tokens
       WHERE user_id = $1 AND revoked = false`,
        [user.id]
      );
      return count;
    }

    async function refreshStatus(cookie: string): Promise<number> {
      const res = await request(http())
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', cookie);
      return res.status;
    }

    // Before the fix the callback issued a session against a full quota, which
    // evicted the oldest device, and the exchange then ended the replaced one.
    it('keeps every other device when the quota is full and the browser signs in again', async () => {
      const devices = await fillQuota();
      const newest = devices[devices.length - 1];

      const oauthData = await callback();
      expect(await liveRows()).toBe(devices.length);

      const exchange = await request(http())
        .post('/api/v1/auth/oauth/exchange')
        .set('Cookie', [oauthData, newest])
        .expect(201);

      expect(await liveRows()).toBe(devices.length);
      expect(await refreshStatus(newest)).toBe(401);
      expect(await refreshStatus(devices[0])).toBe(200);
      expect(await refreshStatus(cookieOf(exchange, refreshCookieName))).toBe(
        200
      );
    }, 60000);

    // Before the fix every callback left a live session that no browser held,
    // and it took a plan slot until it expired.
    it('leaves no session behind a callback that is never exchanged', async () => {
      const before = await liveRows();

      await callback();

      expect(await liveRows()).toBe(before);
    }, 30000);
  }
);
