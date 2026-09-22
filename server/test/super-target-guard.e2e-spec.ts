import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { DataSource, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { withPrivateThrottlerStorage } from './private-throttler';

// A delegated role must not reach a super account: it could set its password,
// or end its sessions with a role change. The migrations create the super role.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('User writes on a super target (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const stamp = Date.now();
  const supportRoleName = `super-target-support-${stamp}`;
  const supportEmail = `super-target-support-${stamp}@example.com`;
  const superEmail = `super-target-super-${stamp}@example.com`;
  const otherSuperEmail = `super-target-other-super-${stamp}@example.com`;
  const plainEmail = `super-target-plain-${stamp}@example.com`;
  const password = 'Lantern-Orchard-47';
  const newPassword = 'Copper-Meadow-83';
  let supportRoleId: string;
  let userRoleId: string;

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

    for (const email of [
      supportEmail,
      superEmail,
      otherSuperEmail,
      plainEmail
    ]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Super', lastName: 'Target' })
        .expect(201);
    }

    const roleService = app.get(RoleService);
    const permissions = await dataSource.getRepository(Permission).find();
    const grant = (action: string, subjectName = 'User') => {
      const found = permissions.find(
        (p) => p.action.name === action && p.resource.subject === subjectName
      );
      if (!found)
        throw new Error(`Permission ${action}:${subjectName} missing`);
      return { permissionId: found.id, conditions: null };
    };
    const support = await roleService.create({ name: supportRoleName });
    supportRoleId = support.id;
    await roleService.setPermissionsForRole(support.id, [
      grant('update'),
      grant('delete'),
      grant('assign', 'Role')
    ]);
    userRoleId = (
      await dataSource.getRepository(Role).findOneByOrFail({ name: 'user' })
    ).id;
    await roleService.assignRoleToUser(await userId(supportEmail), support.id);

    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    for (const email of [superEmail, otherSuperEmail]) {
      await roleService.assignRoleToUser(await userId(email), superRole.id);
    }
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(User)
      .delete([
        { email: supportEmail },
        { email: superEmail },
        { email: otherSuperEmail },
        { email: plainEmail }
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
      .findOneOrFail({ where: { email }, withDeleted: true });
    return found.id;
  }

  // Minted through AuthService.login: the login route allows fewer requests
  // a minute than this suite needs.
  async function tokenFor(email: string): Promise<string> {
    const user = await usersService.findOne(await userId(email));
    const { tokens } = await authService.login(user, 'super-target-e2e');
    return tokens.access_token;
  }

  async function row(email: string): Promise<User> {
    return dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email }, withDeleted: true });
  }

  function expectSuperTargetRefusal(res: request.Response): void {
    expect(res.status).toBe(403);
    expect((res.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.USERS.SUPER_TARGET_FORBIDDEN
    );
  }

  it('refuses a password change on a super account by a delegated role', async () => {
    const token = await tokenFor(supportEmail);

    const res = await request(http())
      .patch(`/api/v1/users/${await userId(superEmail)}`)
      .auth(token, { type: 'bearer' })
      .send({ password: newPassword, currentPassword: password });

    expectSuperTargetRefusal(res);
    const target = await row(superEmail);
    expect(await bcrypt.compare(password, target.password ?? '')).toBe(true);
  }, 30000);

  it('refuses the super target before it reads the factor of the caller', async () => {
    const token = await tokenFor(supportEmail);

    const res = await request(http())
      .patch(`/api/v1/users/${await userId(superEmail)}`)
      .auth(token, { type: 'bearer' })
      .send({ password: newPassword });

    expectSuperTargetRefusal(res);
  }, 30000);

  it('refuses a deactivation of a super account by a delegated role', async () => {
    const token = await tokenFor(supportEmail);

    const res = await request(http())
      .patch(`/api/v1/users/${await userId(superEmail)}`)
      .auth(token, { type: 'bearer' })
      .send({ isActive: false });

    expectSuperTargetRefusal(res);
    expect((await row(superEmail)).isActive).toBe(true);
  }, 30000);

  it('refuses a delete of a super account by a delegated role', async () => {
    const token = await tokenFor(supportEmail);

    const res = await request(http())
      .delete(`/api/v1/users/${await userId(superEmail)}`)
      .auth(token, { type: 'bearer' });

    expectSuperTargetRefusal(res);
    expect((await row(superEmail)).deletedAt).toBeNull();
  }, 30000);

  it('refuses a restore of a super account by a delegated role', async () => {
    const token = await tokenFor(supportEmail);
    const id = await userId(superEmail);
    await usersService.remove(id, SYSTEM_ABILITY);

    try {
      const res = await request(http())
        .post(`/api/v1/users/${id}/restore`)
        .auth(token, { type: 'bearer' });

      expectSuperTargetRefusal(res);
      expect((await row(superEmail)).deletedAt).not.toBeNull();
    } finally {
      await usersService.restore(id, SYSTEM_ABILITY);
    }
  }, 30000);

  it('lets a super actor change a super account', async () => {
    const token = await tokenFor(otherSuperEmail);

    await request(http())
      .patch(`/api/v1/users/${await userId(superEmail)}`)
      .auth(token, { type: 'bearer' })
      .send({ firstName: 'Renamed' })
      .expect(200);
    expect((await row(superEmail)).firstName).toBe('Renamed');
  }, 30000);

  it('lets the delegated role change an ordinary account', async () => {
    const token = await tokenFor(supportEmail);

    await request(http())
      .patch(`/api/v1/users/${await userId(plainEmail)}`)
      .auth(token, { type: 'bearer' })
      .send({ firstName: 'Renamed' })
      .expect(200);
    expect((await row(plainEmail)).firstName).toBe('Renamed');
  }, 30000);
  it('refuses a role assignment on a super account by a delegated role', async () => {
    const token = await tokenFor(supportEmail);

    const res = await request(http())
      .post(`/api/v1/roles/assign/${await userId(superEmail)}`)
      .auth(token, { type: 'bearer' })
      .send({ roleId: supportRoleId });

    expectSuperTargetRefusal(res);
    const target = await usersService.findOne(await userId(superEmail));
    expect(target.roles.map((r) => r.name)).not.toContain(supportRoleName);
    expect(target.tokenRevokedAt).toBeNull();
  }, 30000);

  it('refuses a role removal on a super account by a delegated role', async () => {
    const token = await tokenFor(supportEmail);

    const res = await request(http())
      .delete(`/api/v1/roles/assign/${await userId(superEmail)}/${userRoleId}`)
      .auth(token, { type: 'bearer' });

    expectSuperTargetRefusal(res);
    const target = await usersService.findOne(await userId(superEmail));
    expect(target.roles.map((r) => r.name)).toContain('user');
    expect(target.tokenRevokedAt).toBeNull();
  }, 30000);

  it('lets the delegated role assign a role to an ordinary account', async () => {
    const token = await tokenFor(supportEmail);

    await request(http())
      .post(`/api/v1/roles/assign/${await userId(plainEmail)}`)
      .auth(token, { type: 'bearer' })
      .send({ roleId: supportRoleId })
      .expect(201);
  }, 30000);
});
