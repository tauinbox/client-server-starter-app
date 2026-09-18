import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { User } from '../src/modules/users/entities/user.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// The soft-delete filter lives in the real repository, so only a real database
// shows whether a deleted account gets the token contract's 401 or a 404.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Refresh for a deleted account (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const email = `refresh-deleted-${Date.now()}@example.com`;
  const password = 'Sunrise-Kettle-19';

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

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

    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Refresh', lastName: 'Deleted' })
      .expect(201);

    await dataSource
      .getRepository(User)
      .update({ email }, { isEmailVerified: true });
  }, 60000);

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  it('answers 401 USER_NOT_FOUND, not 404, when the account was soft-deleted first', async () => {
    const http = app.getHttpServer() as Server;
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const cookies = ([] as string[]).concat(login.headers['set-cookie'] ?? []);
    const refreshCookie = cookies.find((c) => c.startsWith('refresh_token='));
    expect(refreshCookie).toBeDefined();

    // The window between the soft-delete and the revocation that follows it.
    await dataSource.getRepository(User).softDelete({ email });

    const refresh = await request(http)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', refreshCookie!.split(';')[0]);

    expect(refresh.status).toBe(401);
    expect((refresh.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.USER_NOT_FOUND
    );
  }, 30000);
});
