import { VersioningType } from '@nestjs/common';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
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
import { RoleService } from '../src/modules/auth/services/role.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { withPrivateThrottlerStorage } from './private-throttler';
import { eventually } from './eventually';

// Every authorization refusal writes one row with the caller ip and request
// id. The guard binds them to the ability, and the instance checks in the
// services read them from there. The whole chain is real: the guards, the
// services, the ability factory and Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Audit row of an authorization refusal (e2e)', () => {
  const tag = `refusal-audit-${Date.now()}`;
  const emails = {
    actor: `${tag}-actor@example.com`,
    victim: `${tag}-victim@example.com`,
    plain: `${tag}-plain@example.com`,
    super: `${tag}-super@example.com`
  };
  const roleNames = ['delegate', 'restrict', 'empty'].map((n) => `${tag}-${n}`);

  let app: NestExpressApplication;
  let dataSource: DataSource;
  const ids = {} as Record<keyof typeof emails, string>;
  let token: string;
  let emptyRole: Role;
  let superRole: Role;
  let systemRole: Role;
  let deleteUser: Permission;

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>(
      HTTP_BODY_APP_OPTIONS
    );
    applyBodyParsers(app);
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    const roleService = app.get(RoleService);

    const userRepository = dataSource.getRepository(User);
    for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
      const saved = await userRepository.save(
        userRepository.create({
          email: emails[key],
          name: `Refusal ${key}`,
          isEmailVerified: true,
          password: null
        })
      );
      ids[key] = saved.id;
    }

    const permissions = await dataSource.getRepository(Permission).find();
    const find = (action: string, resource: string): Permission => {
      const found = permissions.find(
        (p) => p.action.name === action && p.resource.subject === resource
      );
      if (!found) throw new Error(`Permission ${action}:${resource} missing`);
      return found;
    };
    deleteUser = find('delete', 'User');
    const updateUser = find('update', 'User');

    const [delegate, restrict, empty] = await Promise.all(
      roleNames.map((name) => roleService.create({ name }, SYSTEM_ABILITY))
    );
    emptyRole = empty;
    await roleService.setPermissionsForRole(
      delegate.id,
      [
        { permissionId: updateUser.id },
        { permissionId: find('update', 'Role').id },
        { permissionId: find('assign', 'Role').id }
      ],
      SYSTEM_ABILITY
    );
    await roleService.setPermissionsForRole(
      restrict.id,
      [
        {
          permissionId: updateUser.id,
          conditions: {
            effect: 'deny',
            fieldMatch: { email: [emails.victim] }
          }
        }
      ],
      SYSTEM_ABILITY
    );
    await roleService.assignRoleToUser(ids.actor, delegate.id, SYSTEM_ABILITY);
    await roleService.assignRoleToUser(ids.actor, restrict.id, SYSTEM_ABILITY);

    const roleRepository = dataSource.getRepository(Role);
    superRole = await roleRepository.findOneByOrFail({ isSuper: true });
    systemRole = await roleRepository.findOneByOrFail({
      isSystem: true,
      isSuper: false
    });
    await roleService.assignRoleToUser(ids.super, superRole.id, SYSTEM_ABILITY);

    const actor = await app
      .get(UsersService)
      .findOne(ids.actor, SYSTEM_ABILITY);
    const { tokens } = await app.get(AuthService).login(actor, {
      userAgent: 'refusal-audit-e2e',
      ipAddress: null
    });
    token = tokens.access_token;
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource
        .getRepository(AuditLog)
        .delete({ actorId: In(Object.values(ids)) });
      await dataSource.getRepository(Role).delete({ name: In(roleNames) });
      await dataSource
        .getRepository(User)
        .delete({ email: In(Object.values(emails)) });
    }
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer();
  }

  function send(
    method: 'delete' | 'patch' | 'post' | 'put',
    path: string,
    requestId: string,
    body?: object
  ) {
    return request(http())
      [method](`/api/v1${path}`)
      .auth(token, { type: 'bearer' })
      .set('X-Request-Id', requestId)
      .send(body);
  }

  async function refusalRow(
    requestId: string,
    action = AuditAction.PERMISSION_CHECK_FAILURE
  ): Promise<AuditLog> {
    const row = await eventually(() =>
      dataSource
        .getRepository(AuditLog)
        .findOne({ where: { action, actorId: ids.actor, requestId } })
    );
    if (!row) throw new Error(`No ${action} row for ${requestId}`);
    expect(row.ipAddress).toEqual(expect.any(String));
    return row;
  }

  it('writes the route guard refusal', async () => {
    const res = await send('delete', `/users/${ids.plain}`, `${tag}-guard`);
    expect(res.status).toBe(403);

    const row = await refusalRow(`${tag}-guard`);
    expect(row.details).toEqual({ required: ['delete:User'] });
  });

  it('writes the instance check refusal', async () => {
    const res = await send('patch', `/users/${ids.victim}`, `${tag}-instance`, {
      name: 'Changed'
    });
    expect(res.status).toBe(403);
    expect((res.body as { errorKey: string }).errorKey).toBe(
      ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS
    );

    const row = await refusalRow(`${tag}-instance`);
    expect(row.targetId).toBe(ids.victim);
    expect(row.details).toMatchObject({ instanceCheck: true });
  });

  it('writes the super-target refusal', async () => {
    const res = await send('patch', `/users/${ids.super}`, `${tag}-target`, {
      name: 'Changed'
    });
    expect((res.body as { errorKey: string }).errorKey).toBe(
      ErrorKeys.USERS.SUPER_TARGET_FORBIDDEN
    );

    const row = await refusalRow(`${tag}-target`);
    expect(row.details).toMatchObject({ superTarget: true });
  });

  it('writes the super-role assignment refusal', async () => {
    const res = await send(
      'post',
      `/roles/assign/${ids.plain}`,
      `${tag}-super-role`,
      { roleId: superRole.id }
    );
    expect((res.body as { errorKey: string }).errorKey).toBe(
      ErrorKeys.ROLES.SUPER_ROLE_ASSIGN_FORBIDDEN
    );

    const row = await refusalRow(`${tag}-super-role`);
    expect(row.targetId).toBe(superRole.id);
    expect(row.details).toMatchObject({ superRole: true });
  });

  it('answers a system role change by privilege with 403 and writes it', async () => {
    const res = await send(
      'put',
      `/roles/${systemRole.id}/permissions`,
      `${tag}-system-role`,
      { items: [] }
    );
    expect(res.status).toBe(403);
    expect((res.body as { errorKey: string }).errorKey).toBe(
      ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
    );

    const row = await refusalRow(`${tag}-system-role`);
    expect(row.targetId).toBe(systemRole.id);
    expect(row.details).toMatchObject({ systemRole: true });
  });

  it('writes the grant refusal', async () => {
    const res = await send(
      'put',
      `/roles/${emptyRole.id}/permissions`,
      `${tag}-grant`,
      { items: [{ permissionId: deleteUser.id }] }
    );
    expect((res.body as { errorKey: string }).errorKey).toBe(
      ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION
    );

    const row = await refusalRow(
      `${tag}-grant`,
      AuditAction.PERMISSION_GRANT_DENIED
    );
    expect(row.targetId).toBe(emptyRole.id);
  });
});
