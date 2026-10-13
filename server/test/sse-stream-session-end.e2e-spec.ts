import { randomUUID } from 'crypto';
import { get, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { decode } from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import {
  AbilityBuilder,
  createMongoAbility,
  type AppAbility
} from '../src/modules/auth/casl/app-ability';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';
import { UsersController } from '../src/modules/users/controllers/users.controller';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { SSE_HEARTBEAT_INTERVAL_MS } from '../src/modules/notifications/notifications.constants';
import { eventually } from './eventually';

// The stream is authenticated once, when it opens. Each test ends the session
// of an open stream on a real path and reads the real response until the
// heartbeat finds the session dead.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const HEARTBEAT_MS = 300;

interface OpenStream {
  body: () => string;
  ended: () => boolean;
  close: () => void;
}

runWithInfra('An SSE stream ends with its session (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let refreshTokenService: RefreshTokenService;
  let usersService: UsersService;
  let usersController: UsersController;
  let port: number;
  const email = `sse-session-end-${Date.now()}@example.com`;
  let userId: string;
  const streams: OpenStream[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    })
      .overrideProvider(SSE_HEARTBEAT_INTERVAL_MS)
      .useValue(HEARTBEAT_MS)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0);
    port = ((app.getHttpServer() as Server).address() as AddressInfo).port;

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    refreshTokenService = app.get(RefreshTokenService);
    usersService = app.get(UsersService);
    usersController = app.get(UsersController);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const repository = dataSource.getRepository(User);
    const user = await repository.save(
      repository.create({
        email,
        firstName: 'Stream',
        lastName: 'Session',
        isEmailVerified: true,
        password: null
      })
    );
    userId = user.id;
  }, 60000);

  beforeEach(async () => {
    await dataSource.getRepository(User).update(userId, { isActive: true });
  });

  afterEach(() => {
    for (const stream of streams.splice(0)) stream.close();
  });

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  async function signIn(): Promise<{
    token: string;
    refreshToken: string;
    sessionId: string;
  }> {
    const user = await usersService.findOne(userId);
    const { tokens } = await authService.login(user, {
      userAgent: 'sse-e2e',
      ipAddress: '203.0.113.9'
    });
    const payload = decode(tokens.access_token) as { sid: string };
    return {
      token: tokens.access_token,
      refreshToken: tokens.refresh_token,
      sessionId: payload.sid
    };
  }

  function openStream(token: string): Promise<OpenStream> {
    return new Promise((resolve, reject) => {
      const req = get(
        {
          port,
          path: '/api/v1/notifications/stream',
          headers: { authorization: `Bearer ${token}` }
        },
        (res: IncomingMessage) => {
          if (res.statusCode !== 200) {
            reject(new Error(`stream status ${res.statusCode}`));
            return;
          }
          let body = '';
          let ended = false;
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => {
            ended = true;
          });
          res.on('error', () => undefined);
          const stream: OpenStream = {
            body: () => body,
            ended: () => ended,
            close: () => req.destroy()
          };
          streams.push(stream);
          resolve(stream);
        }
      );
      req.on('error', () => undefined);
    });
  }

  const superAbility = (): AppAbility => {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can('manage', 'all');
    return build();
  };

  const adminRequest = (): JwtAuthRequest => {
    const req = {
      user: {
        userId: randomUUID(),
        email: 'admin@example.com',
        roles: [],
        sessionId: randomUUID()
      },
      ip: '127.0.0.1',
      headers: {}
    };
    // @ts-expect-error partial request: the update reads only these fields
    return req;
  };

  const expectInvalidatedAndEnded = async (stream: OpenStream) => {
    await eventually(
      () => Promise.resolve(stream.ended() ? true : null),
      HEARTBEAT_MS * 10
    );
    expect(stream.ended()).toBe(true);
    expect(stream.body()).toContain(
      `data: ${JSON.stringify({ type: 'session_invalidated', userId })}`
    );
  };

  it('ends the stream of a signed-out session and keeps the stream of another session', async () => {
    const a = await signIn();
    const b = await signIn();
    const streamA = await openStream(a.token);
    const streamB = await openStream(b.token);

    expect(await authService.logoutSession(userId, a.refreshToken)).toBe(true);

    await expectInvalidatedAndEnded(streamA);
    expect(streamB.ended()).toBe(false);
    expect(streamB.body()).not.toContain('session_invalidated');
  }, 30000);

  it('ends the streams of the other sessions when they are ended', async () => {
    const a = await signIn();
    const b = await signIn();
    const streamA = await openStream(a.token);
    const streamB = await openStream(b.token);

    await refreshTokenService.deleteOtherSessions(userId, b.sessionId);

    await expectInvalidatedAndEnded(streamA);
    expect(streamB.ended()).toBe(false);
  }, 30000);

  it('ends the stream when an administrator deactivates the user', async () => {
    const a = await signIn();
    const stream = await openStream(a.token);

    await usersController.update(
      userId,
      { isActive: false },
      adminRequest(),
      superAbility()
    );

    await expectInvalidatedAndEnded(stream);
  }, 30000);

  it('keeps the stream of a live session open across heartbeats', async () => {
    const a = await signIn();
    const stream = await openStream(a.token);

    await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 4));

    expect(stream.ended()).toBe(false);
    expect(stream.body()).not.toContain('session_invalidated');
  }, 30000);
});
