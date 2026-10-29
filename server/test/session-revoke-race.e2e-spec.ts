import { INestApplication, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource, DeleteQueryBuilder, MoreThanOrEqual } from 'typeorm';
import type { DeleteResult } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import type { ActiveSessionResponse } from '@app/shared/types';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { withPrivateThrottlerStorage } from './private-throttler';
import { eventually } from './eventually';

// Two requests that end the same session are held in front of the delete of
// refresh rows and released together, so both run their delete against
// Postgres at once. Only one of them may report the end.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Session revoke race (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const stamp = Date.now();
  const email = `sessions-race-${stamp}@example.com`;
  const password = 'Lantern-Orchard-47';

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    const expressApp = moduleRef.createNestApplication<NestExpressApplication>(
      HTTP_BODY_APP_OPTIONS
    );
    applyBodyParsers(expressApp);
    app = expressApp;
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    usersService = app.get(UsersService);

    await request(http())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Race Owner' })
      .expect(201);
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function signIn(
    userAgent: string
  ): Promise<{ token: string; sessionId: string }> {
    const found = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    const user = await usersService.findOne(found.id, SYSTEM_ABILITY);
    const { tokens } = await authService.login(user, {
      userAgent,
      ipAddress: '203.0.113.7'
    });

    const list = await request(http())
      .get('/api/v1/auth/sessions')
      .auth(tokens.access_token, { type: 'bearer' })
      .expect(200);
    const current = (list.body as ActiveSessionResponse[]).find(
      (s) => s.current
    );
    if (!current) throw new Error('the new session is not in the list');
    return { token: tokens.access_token, sessionId: current.id };
  }

  /** Holds the first `count` deletes of refresh rows until all have arrived. */
  function holdRefreshDeletes(count: number): { held: () => number } {
    let held = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
      setTimeout(resolve, 5000).unref();
    });
    const original: (
      this: DeleteQueryBuilder<RefreshToken>
    ) => Promise<DeleteResult> = DeleteQueryBuilder.prototype.execute;
    jest
      .spyOn(DeleteQueryBuilder.prototype, 'execute')
      .mockImplementation(async function (
        this: DeleteQueryBuilder<RefreshToken>
      ) {
        if (
          held < count &&
          this.expressionMap.mainAlias?.target === RefreshToken
        ) {
          held += 1;
          if (held === count) release();
          await gate;
        }
        return original.call(this);
      });
    return { held: () => held };
  }

  it('reports the end of one session once when two requests race', async () => {
    const a = await signIn('Device-A');
    const b = await signIn('Device-B');
    const since = new Date();
    const barrier = holdRefreshDeletes(2);

    const revoke = () =>
      request(http())
        .delete(`/api/v1/auth/sessions/${b.sessionId}`)
        .auth(a.token, { type: 'bearer' })
        .send({ currentPassword: password });
    const responses = await Promise.all([revoke(), revoke()]);

    expect(barrier.held()).toBe(2);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 404]);
    const loser = responses.find((r) => r.status === 404);
    expect((loser?.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.SESSION_NOT_FOUND
    );

    const rows = await eventually(async () => {
      const found = await dataSource.getRepository(AuditLog).find({
        where: {
          action: AuditAction.SESSION_REVOKE,
          actorEmail: email,
          createdAt: MoreThanOrEqual(since)
        }
      });
      return found.length > 0 ? found : null;
    });
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.details).toEqual({ scope: 'one', count: 1 });
  }, 30000);
});
