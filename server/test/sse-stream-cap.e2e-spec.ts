import { get, type ClientRequest, type Server } from 'http';
import type { AddressInfo } from 'net';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { MAX_SSE_STREAMS_PER_USER } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { eventually } from './eventually';

const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

interface StreamResponse {
  status: number;
  body: string;
  close: () => void;
}

runWithInfra('The open SSE streams of one user are limited (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let port: number;
  let token: string;
  const email = `sse-stream-cap-${Date.now()}@example.com`;
  const requests: ClientRequest[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0);
    port = ((app.getHttpServer() as Server).address() as AddressInfo).port;

    dataSource = app.get(DataSource);
    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const repository = dataSource.getRepository(User);
    const user = await repository.save(
      repository.create({
        email,
        firstName: 'Stream',
        lastName: 'Cap',
        isEmailVerified: true,
        password: null
      })
    );
    const { tokens } = await app
      .get(AuthService)
      .login(await app.get(UsersService).findOne(user.id), {
        userAgent: 'sse-e2e',
        ipAddress: '203.0.113.9'
      });
    token = tokens.access_token;
  }, 60000);

  afterAll(async () => {
    for (const req of requests) req.destroy();
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  // Resolves at the status line. The body of a refused stream is read in
  // full; an accepted stream stays open until close().
  function requestStream(): Promise<StreamResponse> {
    return new Promise((resolve, reject) => {
      const req = get(
        {
          port,
          path: '/api/v1/notifications/stream',
          headers: { authorization: `Bearer ${token}` }
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const close = () => req.destroy();
          res.on('error', () => undefined);
          if (status === 200) {
            resolve({ status, body: '', close });
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status, body, close }));
        }
      );
      req.on('error', reject);
      requests.push(req);
    });
  }

  it('accepts the streams up to the limit, refuses the next with 429 and accepts one again after a stream closes', async () => {
    const open: StreamResponse[] = [];
    for (let i = 0; i < MAX_SSE_STREAMS_PER_USER; i++) {
      open.push(await requestStream());
    }
    expect(open.map((stream) => stream.status)).toEqual(
      Array<number>(MAX_SSE_STREAMS_PER_USER).fill(200)
    );

    const refused = await requestStream();
    expect(refused.status).toBe(429);
    expect(JSON.parse(refused.body)).toMatchObject({
      statusCode: 429,
      message: 'Too many open notification streams'
    });

    open[0].close();
    const reopened = await eventually(async () => {
      const stream = await requestStream();
      if (stream.status === 200) return stream;
      return null;
    });
    expect(reopened?.status).toBe(200);
  }, 30000);
});
