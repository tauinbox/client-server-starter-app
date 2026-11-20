import { get, type Server } from 'http';
import type { AddressInfo } from 'net';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { User } from '../src/modules/users/entities/user.entity';

// An API answer can hold personal data, so no browser, proxy or CDN may store
// it. Only a real app proves the order: the header is set before the guard, so
// a refusal carries it too, and the SSE stream keeps the header of Nest.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('API answers carry Cache-Control: no-store (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let port: number;
  let token: string;
  const email = `api-cache-control-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0);
    ({ port } = (app.getHttpServer() as Server).address() as AddressInfo);

    dataSource = app.get(DataSource);
    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const repository = dataSource.getRepository(User);
    const user = await repository.save(
      repository.create({
        email,
        name: 'Cache Control',
        isEmailVerified: true,
        password: null
      })
    );
    const { tokens } = await app
      .get(AuthService)
      .login(await app.get(UsersService).findOne(user.id, SYSTEM_ABILITY), {
        userAgent: 'cache-control-e2e',
        ipAddress: '203.0.113.9'
      });

    token = tokens.access_token;
  }, 60000);

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  it('a JSON answer with personal data is no-store', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({ email });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('a refusal by the guard is no-store', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/auth/profile')
      .expect(401);

    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('the SSE stream keeps the Cache-Control of Nest', async () => {
    const header = await new Promise<string | undefined>((resolve, reject) => {
      const req = get(
        {
          port,
          path: '/api/v1/notifications/stream',
          headers: { authorization: `Bearer ${token}` }
        },
        (res) => {
          res.on('error', () => undefined);
          expect(res.statusCode).toBe(200);
          resolve(res.headers['cache-control']);
          req.destroy();
        }
      );

      req.on('error', reject);
    });

    expect(header).toBe(
      'private, no-cache, no-store, must-revalidate, max-age=0, no-transform'
    );
  }, 30000);
});
