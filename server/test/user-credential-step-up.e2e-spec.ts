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
import { verifyPassword } from '../src/common/utils/password-hash';
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
import { Role } from '../src/modules/auth/entities/role.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { MailService } from '../src/modules/mail/mail.service';
import { maskEmail } from '../src/common/utils/escape-html';
import { withPrivateThrottlerStorage } from './private-throttler';
import { eventually } from './eventually';

// A credential change of another account proves the factor of the CALLER; on
// the own record the profile flows own it, so the route refuses it outright.
// CI runs the migrations and not the seeders, so the suite grants the seeded
// ownership condition, and an unconditional one, through roles of its own.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('PATCH /users/:id credential step-up (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const stamp = Date.now();
  const selfEditRoleName = `step-up-self-edit-${stamp}`;
  const adminEditRoleName = `step-up-admin-edit-${stamp}`;
  const adminEmail = `step-up-admin-${stamp}@example.com`;
  const ownerEmail = `step-up-owner-${stamp}@example.com`;
  const otherEmail = `step-up-other-${stamp}@example.com`;
  const movedEmail = `step-up-moved-${stamp}@example.com`;
  const password = 'Lantern-Orchard-47';
  const newPassword = 'Copper-Meadow-83';

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

    for (const email of [adminEmail, ownerEmail, otherEmail]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Step', lastName: 'Up' })
        .expect(201);
    }

    // The seeded grant of the `user` role: update, on the own record only.
    const roleService = app.get(RoleService);
    const updateUser = (await dataSource.getRepository(Permission).find()).find(
      (p) => p.action.name === 'update' && p.resource.subject === 'User'
    );
    if (!updateUser) throw new Error('Permission update:User missing');
    const selfEdit = await roleService.create({ name: selfEditRoleName });
    await roleService.setPermissionsForRole(selfEdit.id, [
      {
        permissionId: updateUser.id,
        conditions: { ownership: { userField: 'id' } }
      }
    ]);
    for (const email of [ownerEmail, otherEmail]) {
      await roleService.assignRoleToUser(await userId(email), selfEdit.id);
    }
    const adminEdit = await roleService.create({ name: adminEditRoleName });
    await roleService.setPermissionsForRole(adminEdit.id, [
      { permissionId: updateUser.id }
    ]);
    await roleService.assignRoleToUser(await userId(adminEmail), adminEdit.id);
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(Role)
      .delete({ name: In([selfEditRoleName, adminEditRoleName]) });
    await dataSource
      ?.getRepository(User)
      .delete([
        { email: adminEmail },
        { email: ownerEmail },
        { email: otherEmail },
        { email: movedEmail }
      ]);
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

  // Minted through AuthService.login: a credential change ends every session,
  // and the login route allows fewer requests a minute than this suite needs.
  async function tokenFor(email: string): Promise<string> {
    const user = await usersService.findOne(await userId(email));
    const { tokens } = await authService.login(user, 'step-up-e2e');
    return tokens.access_token;
  }

  async function holdsPassword(id: string, value: string): Promise<boolean> {
    const row = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { id } });
    return (
      row.password !== null &&
      (await verifyPassword(value, row.password, row.passwordHashVersion)).valid
    );
  }

  function patch(token: string, id: string, body: object) {
    return request(http())
      .patch(`/api/v1/users/${id}`)
      .auth(token, { type: 'bearer' })
      .send(body);
  }

  function stepUpFailures(actorEmail: string): Promise<number> {
    return dataSource.getRepository(AuditLog).count({
      where: { action: AuditAction.STEP_UP_FAILURE, actorEmail }
    });
  }

  it('refuses a password change on another record without the factor of the caller', async () => {
    const id = await userId(otherEmail);
    const token = await tokenFor(adminEmail);

    const refused = await patch(token, id, { password: newPassword });
    expect(refused.status).toBe(400);
    expect((refused.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    );
    expect(await holdsPassword(id, password)).toBe(true);

    const audit = await eventually(() =>
      dataSource.getRepository(AuditLog).findOne({
        where: { action: AuditAction.STEP_UP_FAILURE, actorEmail: adminEmail },
        order: { createdAt: 'DESC' }
      })
    );
    expect(audit?.details).toMatchObject({
      operation: STEP_UP_OPERATION.USER_CREDENTIAL_CHANGE,
      factor: 'password'
    });
  }, 30000);

  it('refuses a wrong current password', async () => {
    const id = await userId(otherEmail);
    const token = await tokenFor(adminEmail);

    const refused = await patch(token, id, {
      password: newPassword,
      currentPassword: 'Wrong-Password-00'
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    );
  }, 30000);

  it('refuses an email change on another record without a factor', async () => {
    const id = await userId(otherEmail);
    const token = await tokenFor(adminEmail);

    const before = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { id } });

    const refused = await patch(token, id, { email: movedEmail });
    expect(refused.status).toBe(400);

    const row = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { id } });
    expect(row.email).toBe(otherEmail);
    expect(row.emailVerificationToken).toBe(before.emailVerificationToken);
  }, 30000);

  it('refuses the credentials of the own record before it reads a factor', async () => {
    const id = await userId(ownerEmail);
    const token = await tokenFor(ownerEmail);
    const failuresBefore = await stepUpFailures(ownerEmail);

    // One body carries the factor: each refused one spends the long-window
    // budget that the last case of the suite still needs.
    for (const body of [
      { password: newPassword, currentPassword: password },
      { email: movedEmail },
      { email: movedEmail, firstName: 'Moved' }
    ]) {
      const refused = await patch(token, id, body);
      expect(refused.status).toBe(400);
      expect((refused.body as { errorKey?: string }).errorKey).toBe(
        ErrorKeys.USERS.CREDENTIAL_SELF
      );
    }

    const row = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { id } });
    expect(row.email).toBe(ownerEmail);
    expect(row.firstName).not.toBe('Moved');
    expect(await holdsPassword(id, password)).toBe(true);
    expect(await stepUpFailures(ownerEmail)).toBe(failuresBefore);
  }, 30000);

  it('keeps a non-credential edit and a resubmitted address free of a factor', async () => {
    const id = await userId(ownerEmail);
    const token = await tokenFor(ownerEmail);

    await patch(token, id, { firstName: 'Renamed' }).expect(200);
    await patch(token, id, { email: ownerEmail, lastName: 'Kept' }).expect(200);

    const row = await usersService.findOne(id);
    expect(row.firstName).toBe('Renamed');
    expect(row.lastName).toBe('Kept');
  }, 30000);

  it('answers 403 for another record before it reads a factor', async () => {
    const token = await tokenFor(ownerEmail);
    const before = await stepUpFailures(ownerEmail);

    const res = await patch(token, await userId(otherEmail), {
      password: newPassword,
      currentPassword: 'Wrong-Password-00'
    });
    expect(res.status).toBe(403);

    expect(await stepUpFailures(ownerEmail)).toBe(before);
  }, 30000);

  it('accepts the credential changes with the current password of the caller', async () => {
    const id = await userId(otherEmail);
    const oldAddressMail = jest
      .spyOn(app.get(MailService), 'sendEmailChangeCompletedNotification')
      .mockResolvedValue(undefined);

    const moved = await patch(await tokenFor(adminEmail), id, {
      email: movedEmail,
      currentPassword: password
    });
    expect(moved.status).toBe(200);
    expect((moved.body as { email: string }).email).toBe(movedEmail);
    // The factor never reaches the record or the audit row.
    const update = await dataSource.getRepository(AuditLog).findOne({
      where: { action: AuditAction.USER_UPDATE, targetId: id },
      order: { createdAt: 'DESC' }
    });
    expect(update?.details).toEqual({ changedFields: ['email'] });
    // The old mailbox hears of the move, and not where the account went.
    expect(oldAddressMail).toHaveBeenCalledTimes(1);
    expect(oldAddressMail).toHaveBeenCalledWith(
      otherEmail,
      maskEmail(movedEmail),
      expect.any(String)
    );

    await patch(await tokenFor(adminEmail), id, {
      password: newPassword,
      currentPassword: password
    }).expect(200);
    expect(await holdsPassword(id, newPassword)).toBe(true);
  }, 30000);
});
