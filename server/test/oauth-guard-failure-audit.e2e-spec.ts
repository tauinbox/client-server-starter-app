import { VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { Server } from 'http';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { TOKEN_PURPOSE } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { cookieName } from '../src/common/utils/host-cookie';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { AuthCookies } from '../src/modules/auth/utils/auth-cookies';
import { bindIntent } from '../src/modules/auth/utils/oauth-flow-intent';
import {
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE
} from '../src/modules/auth/constants/oauth.constants';
import { withPrivateThrottlerStorage } from './private-throttler';

// A callback that the provider guard refuses never reaches the handler, so the
// exception filter writes its audit row. The state is forged: the state check
// fails before any call to the provider. Skips without DB_HOST.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const STATE = 'forged';

runWithInfra('Audit of a callback refused at the provider guard (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Server;
  let jwt: JwtService;
  let secure: boolean;
  const requestIds: string[] = [];
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Dummy credentials only register the strategy.
    for (const [key, value] of Object.entries({
      GOOGLE_CLIENT_ID: 'e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'e2e-client-secret'
    })) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }

    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    const expressApp = moduleRef.createNestApplication<NestExpressApplication>(
      HTTP_BODY_APP_OPTIONS
    );

    applyBodyParsers(expressApp);
    app = expressApp;
    app.use(cookieParser());
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    server = app.getHttpServer() as Server;
    jwt = app.get(JwtService);
    secure = app.get(AuthCookies).secure;
  }, 60000);

  afterAll(async () => {
    if (requestIds.length) {
      await dataSource
        ?.getRepository(AuditLog)
        .delete(requestIds.map((requestId) => ({ requestId })));
    }

    await app?.close();
    passport.unuse('google');

    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function intentCookie(
    base: string,
    { purpose, sub }: { purpose: string; sub: string }
  ): string {
    const token = jwt.sign({
      sub,
      email: 'owner@example.com',
      purpose,
      operation: 'email_change'
    });

    return `${cookieName(base, secure)}=${bindIntent(token, STATE)}`;
  }

  async function callback(cookie?: string): Promise<AuditLog[]> {
    const requestId = `guard-audit-${randomBytes(8).toString('hex')}`;

    requestIds.push(requestId);
    const req = request(server)
      .get(`/api/v1/auth/oauth/google/callback?state=${STATE}&code=x`)
      .set('X-Request-Id', requestId);

    if (cookie) req.set('Cookie', cookie);

    const res = await req;

    expect(res.status).toBe(302);

    // The row is written fire-and-forget, after the redirect.
    const repository = dataSource.getRepository(AuditLog);
    const deadline = Date.now() + 5000;

    for (;;) {
      const rows = await repository.find({ where: { requestId } });

      if (rows.length > 0 || Date.now() > deadline) return rows;

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it('writes a refused sign-in row for a plain callback', async () => {
    const rows = await callback();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditAction.USER_LOGIN_FAILURE,
      actorId: null,
      details: { method: 'oauth', provider: 'google', reason: 'auth_failed' }
    });
  }, 30000);

  it('writes a step-up row that names the account of a verified reauth intent', async () => {
    const sub = randomUUID();
    const rows = await callback(
      intentCookie(OAUTH_REAUTH_COOKIE, {
        purpose: TOKEN_PURPOSE.OAUTH_REAUTH,
        sub
      })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditAction.STEP_UP_FAILURE,
      actorId: sub,
      actorEmail: 'owner@example.com',
      targetId: sub,
      details: {
        operation: 'email_change',
        factor: 'reauth_proof',
        provider: 'google',
        reason: 'reauth_failed'
      }
    });
  }, 30000);

  it('writes a link row that names the account of a verified link intent', async () => {
    const sub = randomUUID();
    const rows = await callback(
      intentCookie(OAUTH_LINK_COOKIE, {
        purpose: TOKEN_PURPOSE.OAUTH_LINK,
        sub
      })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: AuditAction.OAUTH_LINK_FAILURE,
      actorId: sub,
      targetId: sub,
      details: { provider: 'google', reason: 'auth_failed' }
    });
  }, 30000);
});
