import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { MAX_FAILED_ATTEMPTS } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { User } from '../src/modules/users/entities/user.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// The lockout exception carries lockedUntil and retryAfter, and the global
// filter rebuilds a closed envelope from it. Only a real HTTP request proves
// which of those fields survive to the wire; a unit test that inspects the
// thrown exception never reaches the filter.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Login lockout envelope (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const email = `lockout-envelope-${Date.now()}@example.com`;
  const password = 'Sunrise-Kettle-19';

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    app = moduleRef.createNestApplication();
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
      .send({ email, password, firstName: 'Lockout', lastName: 'Envelope' })
      .expect(201);
  }, 60000);

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function lockAccount(): Promise<Date> {
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    await dataSource.getRepository(User).update(
      { email },
      {
        isEmailVerified: true,
        failedLoginAttempts: MAX_FAILED_ATTEMPTS,
        lockedUntil
      }
    );
    return lockedUntil;
  }

  it('carries retryAfter, lockedUntil and a named status on the 423', async () => {
    const lockedUntil = await lockAccount();

    const response = await request(http())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(423);

    const body = response.body as {
      error: string;
      errorKey: string;
      lockedUntil: string;
      retryAfter: number;
    };
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.lockedUntil).toBe(lockedUntil.toISOString());
    expect(body.error).toBe('Locked');
    expect(body.errorKey).toBe('errors.auth.accountLocked');
    expect(response.headers['retry-after']).toBe(String(body.retryAfter));
  }, 30000);

  it('answers the generic 401 when the password is wrong on a locked account', async () => {
    await lockAccount();

    const response = await request(http())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Wrong-Password-42' })
      .expect(401);

    const body = response.body as { retryAfter?: number };
    expect(body.retryAfter).toBeUndefined();
    expect(response.headers['retry-after']).toBeUndefined();

    // The retry must not extend the window it was rejected by
    const after = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email });
    expect(after.failedLoginAttempts).toBe(MAX_FAILED_ATTEMPTS);
  }, 30000);
});
