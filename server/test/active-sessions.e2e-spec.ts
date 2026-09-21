import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import type { ActiveSessionResponse } from '@app/shared/types';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// The whole pipeline is real: the global JWT guard, whose session check is what
// ends the access token of a device, the step-up, and the scoped delete.
// Sessions are minted through AuthService.login, because the login route
// allows 3 requests a minute and this suite needs more devices than that.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Active sessions (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const stamp = Date.now();
  const ownerEmail = `sessions-owner-${stamp}@example.com`;
  const otherEmail = `sessions-other-${stamp}@example.com`;
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
    authService = app.get(AuthService);
    usersService = app.get(UsersService);

    for (const email of [ownerEmail, otherEmail]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Session', lastName: 'Owner' })
        .expect(201);
    }
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(User)
      .delete([{ email: ownerEmail }, { email: otherEmail }]);
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  /** One signed-in device: its bearer token and its session id. */
  async function signIn(
    email: string,
    userAgent: string
  ): Promise<{ token: string; sessionId: string }> {
    const found = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    const user = await usersService.findOne(found.id);
    const { tokens } = await authService.login(user, userAgent);

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

  async function profileStatus(token: string): Promise<number> {
    const res = await request(http())
      .get('/api/v1/auth/profile')
      .auth(token, { type: 'bearer' });
    return res.status;
  }

  it('lists every device, marks the caller and carries the user agent', async () => {
    const a = await signIn(ownerEmail, 'Device-A');
    const b = await signIn(ownerEmail, 'Device-B');

    const res = await request(http())
      .get('/api/v1/auth/sessions')
      .auth(a.token, { type: 'bearer' })
      .expect(200);
    const sessions = res.body as ActiveSessionResponse[];

    const mine = sessions.find((s) => s.id === a.sessionId);
    const theirs = sessions.find((s) => s.id === b.sessionId);
    expect(mine).toMatchObject({ current: true, userAgent: 'Device-A' });
    expect(theirs).toMatchObject({ current: false, userAgent: 'Device-B' });
    expect(Date.parse(theirs!.startedAt)).not.toBeNaN();
    expect(Date.parse(theirs!.lastActiveAt)).not.toBeNaN();
  }, 30000);

  it('ends one other device at once and keeps the caller signed in', async () => {
    const a = await signIn(ownerEmail, 'Device-A');
    const b = await signIn(ownerEmail, 'Device-B');
    expect(await profileStatus(b.token)).toBe(200);

    // No factor: refused before anything is looked up.
    const refused = await request(http())
      .delete(`/api/v1/auth/sessions/${b.sessionId}`)
      .auth(a.token, { type: 'bearer' });
    expect(refused.status).toBe(400);
    expect(await profileStatus(b.token)).toBe(200);

    await request(http())
      .delete(`/api/v1/auth/sessions/${b.sessionId}`)
      .auth(a.token, { type: 'bearer' })
      .send({ currentPassword: password })
      .expect(200);

    expect(await profileStatus(b.token)).toBe(401);
    expect(await profileStatus(a.token)).toBe(200);

    const audit = await dataSource.getRepository(AuditLog).findOne({
      where: { action: AuditAction.SESSION_REVOKE, actorEmail: ownerEmail },
      order: { createdAt: 'DESC' }
    });
    expect(audit?.details).toEqual({ scope: 'one', count: 1 });
  }, 30000);

  it('answers 404 for an unknown id and for a session of another account', async () => {
    const a = await signIn(ownerEmail, 'Device-A');
    const foreign = await signIn(otherEmail, 'Device-X');

    for (const id of [randomUUID(), foreign.sessionId]) {
      const res = await request(http())
        .delete(`/api/v1/auth/sessions/${id}`)
        .auth(a.token, { type: 'bearer' })
        .send({ currentPassword: password });
      expect(res.status).toBe(404);
      expect((res.body as { errorKey?: string }).errorKey).toBe(
        ErrorKeys.AUTH.SESSION_NOT_FOUND
      );
    }

    expect(await profileStatus(foreign.token)).toBe(200);
  }, 30000);

  it('refuses to end the session of the calling device', async () => {
    const a = await signIn(ownerEmail, 'Device-A');

    const res = await request(http())
      .delete(`/api/v1/auth/sessions/${a.sessionId}`)
      .auth(a.token, { type: 'bearer' })
      .send({ currentPassword: password });

    expect(res.status).toBe(400);
    expect((res.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.SESSION_IS_CURRENT
    );
    expect(await profileStatus(a.token)).toBe(200);
  }, 30000);

  it('ends every other device and no other account', async () => {
    const a = await signIn(ownerEmail, 'Device-A');
    const c = await signIn(ownerEmail, 'Device-C');
    const d = await signIn(ownerEmail, 'Device-D');
    const foreign = await signIn(otherEmail, 'Device-Y');

    const refused = await request(http())
      .delete('/api/v1/auth/sessions')
      .auth(a.token, { type: 'bearer' })
      .send({ currentPassword: 'Wrong-Password-00' });
    expect(refused.status).toBe(400);
    expect(await profileStatus(c.token)).toBe(200);

    const res = await request(http())
      .delete('/api/v1/auth/sessions')
      .auth(a.token, { type: 'bearer' })
      .send({ currentPassword: password })
      .expect(200);
    expect((res.body as { count: number }).count).toBeGreaterThanOrEqual(2);

    expect(await profileStatus(c.token)).toBe(401);
    expect(await profileStatus(d.token)).toBe(401);
    expect(await profileStatus(a.token)).toBe(200);
    expect(await profileStatus(foreign.token)).toBe(200);

    const list = await request(http())
      .get('/api/v1/auth/sessions')
      .auth(a.token, { type: 'bearer' })
      .expect(200);
    expect((list.body as ActiveSessionResponse[]).map((s) => s.id)).toEqual([
      a.sessionId
    ]);
  }, 30000);
});
