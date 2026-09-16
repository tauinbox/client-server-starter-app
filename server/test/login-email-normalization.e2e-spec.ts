import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// The login route has no `@Body()` DTO and NestJS runs guards before pipes, so
// nothing in a unit test can prove the raw body is canonicalized on the way to
// passport - only a real HTTP request through the guard chain can.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Login email normalization (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const email = `login-normalize-${Date.now()}@example.com`;
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
      .send({ email, password, firstName: 'Login', lastName: 'Normalize' })
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

  it('accepts the registered address typed in a different case', async () => {
    const response = await request(http())
      .post('/api/v1/auth/login')
      .send({ email: ` ${email.toUpperCase()} `, password })
      .expect(200);

    const body = response.body as { tokens?: { access_token?: string } };
    expect(body.tokens?.access_token).toBeTruthy();
  }, 30000);

  it('rejects a non-string email as invalid credentials, not a server error', async () => {
    await request(http())
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password })
      .expect(401);
  }, 30000);

  // `LoginDto` caps the address at 255, but the pipe never runs on this route.
  // The strategy applies the cap, so the refusal stays a 401 and neither the
  // lookup nor the audit row receives the oversized value.
  it('rejects an over-long address as invalid credentials without passing it on', async () => {
    const lookup = jest.spyOn(app.get(UsersService), 'findByEmail');
    const audit = jest.spyOn(app.get(AuditService), 'logFireAndForget');
    try {
      await request(http())
        .post('/api/v1/auth/login')
        .send({ email: `${'a'.repeat(10_000)}@example.com`, password })
        .expect(401);

      expect(lookup).toHaveBeenCalledWith('');
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_LOGIN_FAILURE,
          actorEmail: ''
        })
      );
    } finally {
      lookup.mockRestore();
      audit.mockRestore();
    }
  }, 30000);
});
