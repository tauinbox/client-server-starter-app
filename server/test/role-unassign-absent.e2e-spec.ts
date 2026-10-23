import {
  HttpException,
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
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
import { Role } from '../src/modules/auth/entities/role.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { withPrivateThrottlerStorage } from './private-throttler';

// A removal that changes nothing must not end the sessions of the target,
// write an audit row or reach the holders of the role.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Removing an absent role or permission (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  let roleService: RoleService;
  let customRoleId: string;
  let readUserId: string;
  const stamp = Date.now();
  const customRoleName = `unassign-absent-${stamp}`;
  const adminEmail = `unassign-absent-admin-${stamp}@example.com`;
  const targetEmail = `unassign-absent-target-${stamp}@example.com`;
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
    roleService = app.get(RoleService);

    for (const email of [adminEmail, targetEmail]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Unassign', lastName: 'Absent' })
        .expect(201);
    }

    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    await roleService.assignRoleToUser(
      await userId(adminEmail),
      superRole.id,
      SYSTEM_ABILITY
    );

    const readUser = (await dataSource.getRepository(Permission).find()).find(
      (p) => p.action.name === 'read' && p.resource.subject === 'User'
    );
    if (!readUser) throw new Error('Permission read:User missing');
    readUserId = readUser.id;
    customRoleId = (
      await roleService.create({ name: customRoleName }, SYSTEM_ABILITY)
    ).id;
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(User)
      .delete([{ email: adminEmail }, { email: targetEmail }]);
    await dataSource
      ?.getRepository(Role)
      .delete({ name: In([customRoleName]) });
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
    const user = await usersService.findOne(
      await userId(email),
      SYSTEM_ABILITY
    );
    const { tokens } = await authService.login(user, {
      userAgent: 'unassign-absent-e2e',
      ipAddress: null
    });
    return { access: tokens.access_token, refresh: tokens.refresh_token };
  }

  async function refreshErrorKey(raw: string): Promise<string> {
    try {
      await authService.refreshTokens(raw, null);
      return 'RESOLVED';
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse() as { errorKey?: string };
        return body.errorKey ?? `STATUS_${error.getStatus()}`;
      }
      throw error;
    }
  }

  function auditRows(action: AuditAction, targetId: string): Promise<number> {
    return dataSource
      .getRepository(AuditLog)
      .count({ where: { action, targetId } });
  }

  it('answers 404 for a role the user does not hold and keeps the sessions of the user', async () => {
    const id = await userId(targetEmail);
    const target = await sessionFor(targetEmail);
    const admin = await sessionFor(adminEmail);

    const res = await request(http())
      .delete(`/api/v1/roles/assign/${id}/${customRoleId}`)
      .auth(admin.access, { type: 'bearer' });

    expect(res.status).toBe(404);
    expect((res.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.ROLES.ROLE_NOT_ASSIGNED
    );
    expect(await auditRows(AuditAction.ROLE_UNASSIGN, id)).toBe(0);
    expect(await refreshErrorKey(target.refresh)).toBe('RESOLVED');
  }, 30000);

  it('removes a role the user holds, audits and ends the sessions of the user', async () => {
    const id = await userId(targetEmail);
    await roleService.assignRoleToUser(id, customRoleId, SYSTEM_ABILITY);
    const target = await sessionFor(targetEmail);
    const admin = await sessionFor(adminEmail);

    const res = await request(http())
      .delete(`/api/v1/roles/assign/${id}/${customRoleId}`)
      .auth(admin.access, { type: 'bearer' });

    expect(res.status).toBe(200);
    expect(await auditRows(AuditAction.ROLE_UNASSIGN, id)).toBe(1);
    expect(await refreshErrorKey(target.refresh)).toBe(
      ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    );
  }, 30000);

  it('answers 404 for a permission the role does not hold and writes no audit row', async () => {
    const admin = await sessionFor(adminEmail);

    const res = await request(http())
      .delete(`/api/v1/roles/${customRoleId}/permissions/${readUserId}`)
      .auth(admin.access, { type: 'bearer' });

    expect(res.status).toBe(404);
    expect((res.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.ROLES.PERMISSION_NOT_ASSIGNED
    );
    expect(await auditRows(AuditAction.PERMISSION_UNASSIGN, customRoleId)).toBe(
      0
    );
  }, 30000);
});
