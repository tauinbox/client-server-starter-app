import { get, type ClientRequest, type Server } from 'http';
import type { AddressInfo, Socket } from 'net';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { MAX_SSE_STREAMS_PER_USER } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import {
  SSE_CONNECTIONS_REF,
  type SseConnectionsRef
} from '../src/modules/core/metrics/metrics.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';

const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('An SSE client that leaves during the auth guard (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Server;
  let port: number;
  let token: string;
  const email = `sse-close-during-guard-${Date.now()}@example.com`;
  const requests: ClientRequest[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0);
    server = app.getHttpServer() as Server;
    port = (server.address() as AddressInfo).port;

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
        lastName: 'Guard',
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

  function openRequest(onStatus?: (status: number) => void): ClientRequest {
    const req = get(
      {
        port,
        path: '/api/v1/notifications/stream',
        headers: { authorization: `Bearer ${token}` }
      },
      (res) => {
        res.on('error', () => undefined);
        res.resume();
        onStatus?.(res.statusCode ?? 0);
      }
    );
    req.on('error', () => undefined);
    requests.push(req);
    return req;
  }

  it('does not register the stream, so it holds no slot of the user', async () => {
    const sessionCheck = app.get(RefreshTokenService);
    const original = sessionCheck.hasLiveSession.bind(sessionCheck);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const guardReached = new Promise<void>((resolve) => (reached = resolve));
    jest
      .spyOn(sessionCheck, 'hasLiveSession')
      .mockImplementationOnce(async (sessionId) => {
        reached();
        await gate;
        return original(sessionId);
      });

    const serverSocket = new Promise<Socket>((resolve) =>
      server.once('connection', resolve)
    );
    const left = openRequest();
    await guardReached;
    const socket = await serverSocket;
    const socketClosed = new Promise((resolve) =>
      socket.once('close', resolve)
    );
    left.destroy();
    await socketClosed;
    release();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(app.get<SseConnectionsRef>(SSE_CONNECTIONS_REF).getCount()).toBe(0);

    const statuses = await Promise.all(
      Array.from(
        { length: MAX_SSE_STREAMS_PER_USER },
        () => new Promise<number>((resolve) => openRequest(resolve))
      )
    );
    expect(statuses).toEqual(Array<number>(MAX_SSE_STREAMS_PER_USER).fill(200));
  }, 30000);
});
