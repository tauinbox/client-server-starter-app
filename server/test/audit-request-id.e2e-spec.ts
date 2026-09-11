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
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// RequestIdMiddleware rejects a malformed X-Request-Id and substitutes a UUID.
// Only a real request proves the value that reaches audit_logs is the sanitised
// one: a unit test never runs the middleware, and the row is written
// fire-and-forget through a repository of its own.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Audit rows carry the sanitised request id (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const email = `audit-request-id-${Date.now()}@example.com`;
  const password = 'Sunrise-Kettle-19';

  // logFireAndForget resolves on its own microtask chain, so the row can land
  // after the response has already been sent.
  const waitForAuditRow = async (
    action: AuditAction
  ): Promise<AuditLog | null> => {
    const repository = dataSource.getRepository(AuditLog);
    for (let attempt = 0; attempt < 40; attempt++) {
      const row = await repository.findOne({
        where: { actorEmail: email, action }
      });
      if (row) return row;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };

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
  }, 60000);

  afterAll(async () => {
    await dataSource?.getRepository(AuditLog).delete({ actorEmail: email });
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  it('stores the response header value, not the malformed header the client sent', async () => {
    const malformed = 'x'.repeat(5000);

    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .set('X-Request-Id', malformed)
      .send({ email, password, firstName: 'Audit', lastName: 'RequestId' })
      .expect(201);

    const header = response.headers['x-request-id'];
    expect(header).not.toBe(malformed);
    expect(header).toMatch(/^[A-Za-z0-9_-]{1,64}$/);

    const row = await waitForAuditRow(AuditAction.USER_REGISTER);
    expect(row).not.toBeNull();
    expect(row?.requestId).toBe(header);
  });
});
