// A provider sign-in issues its session at the exchange, the one request that
// carries the refresh cookie of the session it replaces. Only the provider
// guard is stubbed.

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  VersioningType
} from '@nestjs/common';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { ErrorKeys, requiresSecureCookies } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-oauth.guard';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { SessionLimitService } from '../src/modules/auth/services/session-limit.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { User } from '../src/modules/users/entities/user.entity';
import type { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';
import { withPrivateThrottlerStorage } from './private-throttler';
import { SCENARIO_CLOCK } from './scenario-clock';
import { trackAuditWrites } from './audit-writes';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra(
  'A provider sign-in issues its session at the exchange (e2e)',
  () => {
    let app: INestApplication;
    let dataSource: DataSource;
    let auditWrites: ReturnType<typeof trackAuditWrites>;
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
      name: 'Exchange Owner',
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
      app.useGlobalPipes(new ApiValidationPipe());
      app.setGlobalPrefix('api');
      app.enableVersioning({ type: VersioningType.URI });
      await app.init();

      dataSource = app.get(DataSource);
      auditWrites = trackAuditWrites(app);
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
          name: profile.name,
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
      await dataSource.getRepository(AuditLog).delete({ targetId: user.id });
      await dataSource
        .getRepository(User)
        .update(user.id, { isActive: true, tokenRevokedAt: null });
    });

    afterAll(async () => {
      if (user) {
        await dataSource.getRepository(AuditLog).delete({ actorId: user.id });
        await dataSource.getRepository(AuditLog).delete({ targetId: user.id });
        // refresh_tokens.user_id and oauth_accounts.user_id cascade on delete.
        await dataSource.getRepository(User).delete({ id: user.id });
      }

      await app?.close();
    });

    /**
     * The refused sign-in rows that name the test account, once every audit
     * write has ended: the write is fire-and-forget.
     */
    function loginFailureRows(): Promise<
      Array<Pick<AuditLog, 'actorId' | 'details'>>
    > {
      return auditWrites.read(() =>
        dataSource.getRepository(AuditLog).find({
          select: { actorId: true, details: true },
          where: {
            action: AuditAction.USER_LOGIN_FAILURE,
            targetId: user.id,
            targetType: 'User'
          }
        })
      );
    }

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
          await usersService.findOne(user.id, SYSTEM_ABILITY),
          { userAgent: `Device-${i}`, ipAddress: null }
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
      const newest = devices.at(-1)!;

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

    // A password reset, an administrator recovery or a provider unlink ends
    // every session. Before the fix a callback that the old holder finished
    // just before it still turned into a fresh session.
    it('refuses an oauth_data cookie issued before a session revocation', async () => {
      SCENARIO_CLOCK.freeze();
      let oauthData: string;

      try {
        oauthData = await callback();
        SCENARIO_CLOCK.advance(100);
        await authService.revokeAllUserSessions(user.id);
      } finally {
        SCENARIO_CLOCK.release();
      }

      const res = await request(http())
        .post('/api/v1/auth/oauth/exchange')
        .set('Cookie', oauthData)
        .expect(401);

      expect(res.body).toMatchObject({
        errorKey: ErrorKeys.AUTH.INVALID_OAUTH_DATA
      });
      expect(await liveRows()).toBe(0);
      expect(await loginFailureRows()).toEqual([
        {
          actorId: null,
          details: {
            method: 'oauth',
            provider: 'google',
            reason: 'session_revoked'
          }
        }
      ]);
    }, 30000);

    // The signed cookie names the account, so the refusal is a failed sign-in
    // of that account. Before the fix it left no trace.
    it('audits an exchange for an account deactivated after the callback', async () => {
      const oauthData = await callback();

      await dataSource.getRepository(User).update(user.id, { isActive: false });

      const res = await request(http())
        .post('/api/v1/auth/oauth/exchange')
        .set('Cookie', oauthData)
        .expect(401);

      expect(res.body).toMatchObject({
        errorKey: ErrorKeys.AUTH.INVALID_OAUTH_DATA
      });
      expect(await loginFailureRows()).toEqual([
        {
          actorId: null,
          details: {
            method: 'oauth',
            provider: 'google',
            reason: 'account_deactivated'
          }
        }
      ]);
    }, 30000);

    // The account comes from its linked identity, not from the address of the
    // profile, so the row names it. Before the fix the row named no account.
    it('names the account in the row of a callback for a deactivated account', async () => {
      await dataSource.getRepository(User).update(user.id, { isActive: false });

      const res = await request(http())
        .get('/api/v1/auth/oauth/google/callback')
        .expect(302);

      expect(res.headers['location']).toMatch(/\/login\?oauth_error=/);
      expect(await loginFailureRows()).toEqual([
        {
          actorId: null,
          details: {
            method: 'oauth',
            provider: 'google',
            reason: 'account_deactivated'
          }
        }
      ]);
    }, 30000);
  }
);
