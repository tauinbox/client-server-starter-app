import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { User } from '../src/modules/users/entities/user.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// A cross-site HTML form can post a urlencoded body with no CORS preflight.
// The app is booted through the same body config as main.ts: Nest's default
// parsers accept that body, so a default test app would pass a vulnerable one.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Login CSRF through a form body (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const email = `login-csrf-${Date.now()}@example.com`;
  const password = 'Sunrise-Kettle-19';

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

    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Login', lastName: 'Csrf' })
      .expect(201);
    await dataSource
      .getRepository(User)
      .update({ email }, { isEmailVerified: true });
  }, 60000);

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  function refreshCookieOf(res: request.Response): string | undefined {
    return ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((cookie) => cookie.startsWith('refresh_token='));
  }

  it('refuses a form-encoded login and sets no session cookie', async () => {
    const res = await request(http())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://attacker.example')
      .type('form')
      .send({ email, password });

    expect(res.status).toBe(401);
    expect(refreshCookieOf(res)).toBeUndefined();
  }, 30000);

  it('still signs in with a JSON body', async () => {
    const res = await request(http())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    expect(refreshCookieOf(res)).toBeDefined();
  }, 30000);

  it('does not parse a form-encoded body on the two-factor routes', async () => {
    // Well-formed fields, so a parsed body would reach the service and get
    // its 401: only an unparsed body fails validation with 400.
    const bodies = {
      verify: { mfaToken: 'not-a-token', code: '123456' },
      recovery: { mfaToken: 'not-a-token', recoveryCode: 'ABCDEFGH-IJKLMNOP' }
    };
    for (const [route, body] of Object.entries(bodies)) {
      const res = await request(http())
        .post(`/api/v1/auth/mfa/${route}`)
        .type('form')
        .send(body);

      expect(res.status).toBe(400);
      expect(refreshCookieOf(res)).toBeUndefined();
    }
  }, 30000);

  it('keeps the raw body the webhook signature check reads', async () => {
    const res = await request(http())
      .post('/api/v1/billing/webhooks/paddle')
      .send({ event_type: 'probe' });

    expect((res.body as { message?: string }).message).not.toBe(
      'Missing webhook body'
    );
  }, 30000);
});
