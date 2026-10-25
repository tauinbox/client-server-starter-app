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
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { User } from '../src/modules/users/entities/user.entity';
import { eventually } from './eventually';

const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

interface StreamResponse {
  status: number;
  body: () => string;
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
        name: 'Stream Cap',
        isEmailVerified: true,
        password: null
      })
    );
    const { tokens } = await app
      .get(AuthService)
      .login(await app.get(UsersService).findOne(user.id, SYSTEM_ABILITY), {
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

  // Resolves at the status line for an accepted stream, which stays open
  // until close(), and at the end of the body for a refused one.
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
          let body = '';
          const response = {
            status,
            body: () => body,
            close: () => req.destroy()
          };
          res.on('error', () => undefined);
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          if (status === 200) {
            resolve(response);
            return;
          }
          res.on('end', () => resolve(response));
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
    expect(JSON.parse(refused.body())).toMatchObject({
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
    for (const stream of [...open.slice(1), reopened]) stream?.close();
  }, 30000);

  // The heartbeat of this app is the default 30 s, so a frame that arrives
  // sooner is the frame sent when the stream opens.
  it('sends a frame when the stream opens', async () => {
    const stream = await eventually(async () => {
      const candidate = await requestStream();
      return candidate.status === 200 ? candidate : null;
    });
    expect(stream?.status).toBe(200);

    const opened = await eventually(() =>
      Promise.resolve(stream?.body().includes('data: \n\n') || null)
    );

    expect(opened).toBe(true);
    stream?.close();
  }, 30000);
});
