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
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
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

// The way back for an owner who lost the authenticator and the recovery codes.
// The whole pipeline is real: the grant, the super-target rule, the caller
// step-up, the conditional clear, the session revocation and the audit row.
// CI runs the migrations and not the seeders, so the suite makes its own role.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('POST /users/:id/mfa/reset (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const stamp = Date.now();
  const supportRoleName = `mfa-reset-support-${stamp}`;
  const supportEmail = `mfa-reset-support-${stamp}@example.com`;
  const ownerEmail = `mfa-reset-owner-${stamp}@example.com`;
  const superEmail = `mfa-reset-super-${stamp}@example.com`;
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
        .send({ email, password, firstName: 'Mfa', lastName: 'Reset' })
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

  // Minted through AuthService.login: the reset ends every session, and the
  // login route allows fewer requests a minute than this suite needs.
  async function tokenFor(email: string): Promise<string> {
    const user = await usersService.findOne(await userId(email));
    const { tokens } = await authService.login(user, 'mfa-reset-e2e');
    return tokens.access_token;
  }

  // The reset never reads the secret, so a stored enrolment is enough.
  async function enrol(email: string): Promise<string> {
    const id = await userId(email);
    await dataSource.getRepository(User).update(id, {
      totpSecret: 'v1.not.a.real.secret',
      totpEnabledAt: new Date(),
      totpRecoveryCodes: ['spent-hash'],
      totpLastUsedStep: 1
    });
    return id;
  }

  function reset(token: string, id: string, body: object) {
    return request(http())
      .post(`/api/v1/users/${id}/mfa/reset`)
      .auth(token, { type: 'bearer' })
      .send(body);
  }

  async function row(id: string): Promise<User> {
    return dataSource.getRepository(User).findOneOrFail({ where: { id } });
  }

  function auditCount(action: AuditAction, targetId: string): Promise<number> {
    return dataSource
      .getRepository(AuditLog)
      .count({ where: { action, targetId } });
  }

  it('refuses without a step-up of the caller and leaves the factor on', async () => {
    const id = await enrol(ownerEmail);

    const refused = await reset(await tokenFor(supportEmail), id, {});
    expect(refused.status).toBe(400);
    expect((refused.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    );
    expect((await row(id)).totpEnabledAt).not.toBeNull();

    const failure = await eventually(() =>
      dataSource.getRepository(AuditLog).findOne({
        where: {
          action: AuditAction.STEP_UP_FAILURE,
          actorEmail: supportEmail
        },
        order: { createdAt: 'DESC' }
      })
    );
    expect(failure?.details).toMatchObject({
      operation: STEP_UP_OPERATION.USER_CREDENTIAL_CHANGE
    });
  }, 30000);

  it('refuses a self-target', async () => {
    const id = await enrol(supportEmail);

    const refused = await reset(await tokenFor(supportEmail), id, {
      currentPassword: password
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.USERS.MFA_RESET_SELF
    );
    expect((await row(id)).totpEnabledAt).not.toBeNull();

    await dataSource.getRepository(User).update(id, {
      totpSecret: null,
      totpEnabledAt: null,
      totpRecoveryCodes: null,
      totpLastUsedStep: null
    });
  }, 30000);

  it('refuses a super target for a non-super caller', async () => {
    const id = await enrol(superEmail);

    const refused = await reset(await tokenFor(supportEmail), id, {
      currentPassword: password
    });
    expect(refused.status).toBe(403);
    expect((await row(id)).totpEnabledAt).not.toBeNull();
  }, 30000);

  it('clears the factor, ends the sessions of the target, audits and lets the owner in with the password alone', async () => {
    const id = await enrol(ownerEmail);
    await tokenFor(ownerEmail);
    expect(
      await dataSource
        .getRepository(RefreshToken)
        .count({ where: { userId: id } })
    ).toBeGreaterThan(0);

    const res = await reset(await tokenFor(supportEmail), id, {
      currentPassword: password
    });
    expect(res.status).toBe(200);
    expect((res.body as { mfaEnabled: boolean }).mfaEnabled).toBe(false);

    const after = await row(id);
    expect(after.totpSecret).toBeNull();
    expect(after.totpEnabledAt).toBeNull();
    expect(after.totpRecoveryCodes).toBeNull();
    expect(after.totpLastUsedStep).toBeNull();
    expect(after.tokenRevokedAt).not.toBeNull();
    expect(
      await dataSource
        .getRepository(RefreshToken)
        .count({ where: { userId: id } })
    ).toBe(0);

    const audit = await dataSource.getRepository(AuditLog).findOne({
      where: { action: AuditAction.MFA_RESET_BY_ADMIN, targetId: id }
    });
    expect(audit?.actorEmail).toBe(supportEmail);

    // Registration leaves the address unverified, and that gate answers first.
    await dataSource.getRepository(User).update(id, { isEmailVerified: true });
    const login = await request(http())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password });
    expect(login.status).toBe(200);
    expect(login.body).not.toHaveProperty('mfaRequired');
  }, 30000);

  it('refuses an account with no factor before the step-up', async () => {
    const id = await userId(ownerEmail);
    const before = await auditCount(AuditAction.MFA_RESET_BY_ADMIN, id);

    const refused = await reset(await tokenFor(supportEmail), id, {
      currentPassword: 'Wrong-Password-00'
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.MFA_NOT_ENABLED
    );
    expect(await auditCount(AuditAction.MFA_RESET_BY_ADMIN, id)).toBe(before);
  }, 30000);
});
