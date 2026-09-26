import {
  HttpException,
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
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
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { withPrivateThrottlerStorage } from './private-throttler';
import { eventually } from './eventually';

// The whole pipeline is real: the grant, the super-target rule, the event bus,
// the revocation listener, the JWT session check and the audit row.
// CI runs the migrations and not the seeders, so the suite makes its own role.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('POST /users/:id/sessions/revoke (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const stamp = Date.now();
  const supportRoleName = `session-revoke-support-${stamp}`;
  const supportEmail = `session-revoke-support-${stamp}@example.com`;
  const ownerEmail = `session-revoke-owner-${stamp}@example.com`;
  const superEmail = `session-revoke-super-${stamp}@example.com`;
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

    for (const email of [supportEmail, ownerEmail, superEmail]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Session', lastName: 'Revoke' })
        .expect(201);
    }

    const roleService = app.get(RoleService);
    const updateUser = (await dataSource.getRepository(Permission).find()).find(
      (p) => p.action.name === 'update' && p.resource.subject === 'User'
    );
    if (!updateUser) throw new Error('Permission update:User missing');
    const support = await roleService.create({ name: supportRoleName });
    await roleService.setPermissionsForRole(support.id, [
      { permissionId: updateUser.id, conditions: null }
    ]);
    await roleService.assignRoleToUser(await userId(supportEmail), support.id);

    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    await roleService.assignRoleToUser(await userId(superEmail), superRole.id);
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(User)
      .delete([
        { email: supportEmail },
        { email: ownerEmail },
        { email: superEmail }
      ]);
    await dataSource
      ?.getRepository(Role)
      .delete({ name: In([supportRoleName]) });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function userId(email: string): Promise<string> {
    const found = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    return found.id;
  }

  // Minted through AuthService.login: the login route allows fewer requests a
  // minute than this suite needs.
  async function sessionFor(
    email: string
  ): Promise<{ access: string; refresh: string }> {
    const user = await usersService.findOne(await userId(email));
    const { tokens } = await authService.login(user, 'session-revoke-e2e');
    return { access: tokens.access_token, refresh: tokens.refresh_token };
  }

  function revoke(token: string, id: string) {
    return request(http())
      .post(`/api/v1/users/${id}/sessions/revoke`)
      .auth(token, { type: 'bearer' })
      .send();
  }

  function profile(token: string) {
    return request(http())
      .get('/api/v1/auth/profile')
      .auth(token, { type: 'bearer' });
  }

  function refreshRows(id: string): Promise<number> {
    return dataSource
      .getRepository(RefreshToken)
      .count({ where: { userId: id } });
  }

  async function refreshErrorKey(raw: string): Promise<string> {
    try {
      await authService.refreshTokens(raw);
      return 'RESOLVED';
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse() as { errorKey?: string };
        return body.errorKey ?? `STATUS_${error.getStatus()}`;
      }
      throw error;
    }
  }

  it('ends every session of the target, keeps the caller signed in and audits', async () => {
    const id = await userId(ownerEmail);
    const first = await sessionFor(ownerEmail);
    const second = await sessionFor(ownerEmail);
    expect((await profile(first.access)).status).toBe(200);
    expect(await refreshRows(id)).toBeGreaterThanOrEqual(2);

    const support = await sessionFor(supportEmail);
    const res = await revoke(support.access, id);
    expect(res.status).toBe(200);

    expect(await refreshRows(id)).toBe(0);
    expect(
      (await dataSource.getRepository(User).findOneByOrFail({ id }))
        .tokenRevokedAt
    ).not.toBeNull();
    expect((await profile(first.access)).status).toBe(401);
    expect((await profile(second.access)).status).toBe(401);
    expect(await refreshErrorKey(first.refresh)).toBe(
      ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    );
    expect((await profile(support.access)).status).toBe(200);

    const audit = await eventually(() =>
      dataSource.getRepository(AuditLog).findOne({
        where: { action: AuditAction.SESSION_REVOKE, targetId: id }
      })
    );
    expect(audit?.actorEmail).toBe(supportEmail);
    expect(audit?.details).toEqual({ scope: 'all', source: 'admin' });
  }, 30000);

  it('refuses a self-target and keeps the session', async () => {
    const support = await sessionFor(supportEmail);

    const refused = await revoke(support.access, await userId(supportEmail));
    expect(refused.status).toBe(400);
    expect((refused.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.USERS.SESSION_REVOKE_SELF
    );
    expect((await profile(support.access)).status).toBe(200);
  }, 30000);

  it('refuses a super target for a non-super caller', async () => {
    const target = await sessionFor(superEmail);

    const refused = await revoke(
      (await sessionFor(supportEmail)).access,
      await userId(superEmail)
    );
    expect(refused.status).toBe(403);
    expect((await profile(target.access)).status).toBe(200);
  }, 30000);

  it('refuses a caller without update:User', async () => {
    const support = await sessionFor(supportEmail);
    const owner = await sessionFor(ownerEmail);

    const refused = await revoke(owner.access, await userId(supportEmail));
    expect(refused.status).toBe(403);
    expect((await profile(support.access)).status).toBe(200);
  }, 30000);

  it('answers 404 for an unknown user', async () => {
    const support = await sessionFor(supportEmail);

    const res = await revoke(support.access, randomUUID());
    expect(res.status).toBe(404);
  }, 30000);
});
