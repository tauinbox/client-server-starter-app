import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// An administrator change to a user and its audit rows commit together: when a
// row cannot be written, the request fails, the record keeps its previous
// state and no session of the target is ended.
// CI runs the migrations and not the seeders; the super role comes from them.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Admin user changes: audit in the write transaction (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let usersService: UsersService;
  let authService: AuthService;
  let token: string;
  const stamp = Date.now();
  const adminEmail = `users-audit-tx-admin-${stamp}@example.com`;
  const targetEmail = `users-audit-tx-target-${stamp}@example.com`;
  const deletedEmail = `users-audit-tx-deleted-${stamp}@example.com`;
  const createdEmail = `users-audit-tx-new-${stamp}@example.com`;
  const movedEmail = `users-audit-tx-moved-${stamp}@example.com`;
  const password = 'Lantern-Orchard-47';
  const newPassword = 'Copper-Meadow-83';
  let targetId: string;
  let deletedId: string;

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
    usersService = app.get(UsersService);
    authService = app.get(AuthService);

    const names = { firstName: 'Users', lastName: 'Tx' };
    const admin = await usersService.create({
      email: adminEmail,
      password,
      ...names
    });
    targetId = (
      await usersService.create({ email: targetEmail, password, ...names })
    ).id;
    deletedId = (
      await usersService.create({ email: deletedEmail, password, ...names })
    ).id;
    await usersService.remove(deletedId, SYSTEM_ABILITY);

    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    await app.get(RoleService).assignRoleToUser(admin.id, superRole.id);
    token = await sessionOf(admin.id);
  }, 60000);

  beforeEach(async () => {
    // Every test starts with a live session of the target.
    await sessionOf(targetId);
    jest
      .spyOn(app.get(AuditService), 'log')
      .mockRejectedValue(new Error('audit down'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dataSource
      ?.getRepository(User)
      .delete([
        { email: adminEmail },
        { email: targetEmail },
        { email: movedEmail },
        { email: deletedEmail },
        { email: createdEmail }
      ]);
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function sessionOf(id: string): Promise<string> {
    const { tokens } = await authService.login(await usersService.findOne(id), {
      userAgent: 'users-audit-tx-e2e',
      ipAddress: null
    });
    return tokens.access_token;
  }

  function stored(id: string): Promise<User> {
    return dataSource
      .getRepository(User)
      .findOneOrFail({ where: { id }, withDeleted: true });
  }

  function sessions(id: string): Promise<number> {
    return dataSource
      .getRepository(RefreshToken)
      .count({ where: { userId: id } });
  }

  function patchTarget(body: object) {
    return request(http())
      .patch(`/api/v1/users/${targetId}`)
      .auth(token, { type: 'bearer' })
      .send(body);
  }

  it('create answers 500 and stores no user', async () => {
    await request(http())
      .post('/api/v1/users')
      .auth(token, { type: 'bearer' })
      .send({
        email: createdEmail,
        password,
        firstName: 'New',
        lastName: 'User'
      })
      .expect(500);

    expect(
      await dataSource.getRepository(User).countBy({ email: createdEmail })
    ).toBe(0);
  });

  it('a password change answers 500, keeps the hash and ends no session', async () => {
    const before = await stored(targetId);

    await patchTarget({
      password: newPassword,
      currentPassword: password
    }).expect(500);

    const after = await stored(targetId);
    expect(after.password).toBe(before.password);
    expect(after.tokenRevokedAt).toBeNull();
    expect(await sessions(targetId)).toBeGreaterThan(0);
  });

  it('an email change answers 500 and keeps the address', async () => {
    await patchTarget({ email: movedEmail, currentPassword: password }).expect(
      500
    );

    expect((await stored(targetId)).email).toBe(targetEmail);
    expect(await sessions(targetId)).toBeGreaterThan(0);
  });

  it('a deactivation answers 500 and keeps the account active', async () => {
    await patchTarget({ isActive: false }).expect(500);

    expect((await stored(targetId)).isActive).toBe(true);
    expect(await sessions(targetId)).toBeGreaterThan(0);
  });

  it('delete answers 500 and keeps the account', async () => {
    await request(http())
      .delete(`/api/v1/users/${targetId}`)
      .auth(token, { type: 'bearer' })
      .expect(500);

    expect((await stored(targetId)).deletedAt).toBeNull();
    expect(await sessions(targetId)).toBeGreaterThan(0);
  });

  it('restore answers 500 and keeps the account deleted', async () => {
    await request(http())
      .post(`/api/v1/users/${deletedId}/restore`)
      .auth(token, { type: 'bearer' })
      .expect(500);

    expect((await stored(deletedId)).deletedAt).not.toBeNull();
  });

  it('an MFA reset answers 500 and keeps the factor', async () => {
    await dataSource.getRepository(User).update(targetId, {
      totpSecret: 'v1.not.a.real.secret',
      totpEnabledAt: new Date(),
      totpRecoveryCodes: ['spent-hash']
    });

    await request(http())
      .post(`/api/v1/users/${targetId}/mfa/reset`)
      .auth(token, { type: 'bearer' })
      .send({ currentPassword: password })
      .expect(500);

    expect((await stored(targetId)).totpEnabledAt).not.toBeNull();
    expect(await sessions(targetId)).toBeGreaterThan(0);

    await dataSource.getRepository(User).update(targetId, {
      totpSecret: null,
      totpEnabledAt: null,
      totpRecoveryCodes: null
    });
  });

  it('a session revoke answers 500 and ends no session', async () => {
    await request(http())
      .post(`/api/v1/users/${targetId}/sessions/revoke`)
      .auth(token, { type: 'bearer' })
      .expect(500);

    expect(await sessions(targetId)).toBeGreaterThan(0);
  });

  it('a password change with a working audit writes its rows and ends the sessions of the target', async () => {
    jest.restoreAllMocks();

    await patchTarget({
      password: newPassword,
      currentPassword: password
    }).expect(200);

    expect(await sessions(targetId)).toBe(0);
    const actions = (
      await dataSource
        .getRepository(AuditLog)
        .findBy({ targetId, actorEmail: adminEmail })
    ).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.USER_UPDATE,
        AuditAction.PASSWORD_CHANGE
      ])
    );
  });
});
