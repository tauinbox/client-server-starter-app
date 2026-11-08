import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import type { EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import type { ActiveSessionResponse } from '@app/shared/types';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { AuthCookies } from '../src/modules/auth/utils/auth-cookies';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { UsersService } from '../src/modules/users/services/users.service';
import { cookieName } from '../src/common/utils/host-cookie';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// A revocation that runs between the INSERT of a sign-in row and its COMMIT
// cannot see the row, so its delete leaves it. The subscriber runs the
// revocation inside the INSERT transaction to force that order.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Revocation during a sign-in (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const email = `revoke-during-sign-in-${Date.now()}@example.com`;
  const password = 'Harbor-Quartz-83';
  let armed = false;

  const revokeInsideInsert: EntitySubscriberInterface<RefreshToken> = {
    listenTo: () => RefreshToken,
    async afterInsert(event: InsertEvent<RefreshToken>) {
      if (!armed) return;

      armed = false;
      await authService.revokeAllUserSessions(event.entity.userId);
    }
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    usersService = app.get(UsersService);
    dataSource.subscribers.push(revokeInsideInsert);

    await request(http())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Revoke Race' })
      .expect(201);

    await dataSource
      .getRepository(User)
      .update({ email }, { isEmailVerified: true });
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      const index = dataSource.subscribers.indexOf(revokeInsideInsert);

      if (index !== -1) dataSource.subscribers.splice(index, 1);

      await dataSource.getRepository(User).delete({ email });
    }

    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  // The service, not the route: the sign-in throttle refuses a fourth login.
  async function signIn(): Promise<{ access: string; refreshCookie: string }> {
    const found = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    const user = await usersService.findOne(found.id, SYSTEM_ABILITY);
    const { tokens } = await authService.login(user, {
      userAgent: 'Revoke-Race',
      ipAddress: '203.0.113.9'
    });
    const name = cookieName('refresh_token', app.get(AuthCookies).secure);

    return {
      access: tokens.access_token,
      refreshCookie: `${name}=${tokens.refresh_token}`
    };
  }

  /** A sign-in whose row commits after a revocation of every session. */
  async function racedSignIn(): Promise<{
    access: string;
    refreshCookie: string;
  }> {
    armed = true;
    const session = await signIn();

    expect(armed).toBe(false);

    const user = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    const rows = await dataSource
      .getRepository(RefreshToken)
      .find({ where: { userId: user.id } });

    // The state under test: the row survived the delete of the revocation.
    expect(user.tokenRevokedAt).not.toBeNull();
    expect(
      rows.some(
        (row) => row.sessionStartedAt.getTime() < user.tokenRevokedAt!.getTime()
      )
    ).toBe(true);

    return session;
  }

  it('refuses the refresh of the raced session and ends it', async () => {
    const { refreshCookie } = await racedSignIn();

    const refresh = await request(http())
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', refreshCookie);

    expect(refresh.status).toBe(401);
    expect((refresh.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    );

    const again = await request(http())
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', refreshCookie);

    expect(again.status).toBe(401);
  }, 30000);

  it('refuses the access token of the raced session', async () => {
    const { access } = await racedSignIn();

    const sessions = await request(http())
      .get('/api/v1/auth/sessions')
      .auth(access, { type: 'bearer' });

    expect(sessions.status).toBe(401);
    expect((sessions.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.TOKEN_REVOKED
    );
  }, 30000);

  it('keeps a sign-in after the revocation and does not list the raced session', async () => {
    await racedSignIn();
    // The next whole second: an access token is floored to its second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const later = await signIn();

    const sessions = await request(http())
      .get('/api/v1/auth/sessions')
      .auth(later.access, { type: 'bearer' })
      .expect(200);

    expect(
      (sessions.body as ActiveSessionResponse[]).map((s) => s.current)
    ).toEqual([true]);

    await request(http())
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', later.refreshCookie)
      .expect(200);
  }, 30000);

  it('does not count the raced session when the other sessions end', async () => {
    await racedSignIn();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const later = await signIn();

    const ended = await request(http())
      .delete('/api/v1/auth/sessions')
      .auth(later.access, { type: 'bearer' })
      .send({ currentPassword: password })
      .expect(200);

    expect((ended.body as { count: number }).count).toBe(0);
  }, 30000);
});
