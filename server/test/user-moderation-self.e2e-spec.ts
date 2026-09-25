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
import { withPrivateThrottlerStorage } from './private-throttler';

// The seeded `user` role may update its own record, and the moderation fields
// of UpdateUserDto rode along: a bare access token deactivated its owner or
// cleared a login lock. CI runs no seeders, so the suite grants the ownership
// condition through a role of its own.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('PATCH /users/:id moderation of the own record (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  const stamp = Date.now();
  const selfEditRoleName = `moderation-self-edit-${stamp}`;
  const moderatorRoleName = `moderation-moderator-${stamp}`;
  const ownerEmail = `moderation-owner-${stamp}@example.com`;
  const moderatorEmail = `moderation-moderator-${stamp}@example.com`;
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

    for (const email of [ownerEmail, moderatorEmail]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Mod', lastName: 'Self' })
        .expect(201);
    }

    const roleService = app.get(RoleService);
    const updateUser = (await dataSource.getRepository(Permission).find()).find(
      (p) => p.action.name === 'update' && p.resource.subject === 'User'
    );
    if (!updateUser) throw new Error('Permission update:User missing');

    // The seeded grant of the `user` role: update, on the own record only.
    const selfEdit = await roleService.create({ name: selfEditRoleName });
    await roleService.setPermissionsForRole(selfEdit.id, [
      {
        permissionId: updateUser.id,
        conditions: { ownership: { userField: 'id' } }
      }
    ]);
    await roleService.assignRoleToUser(await userId(ownerEmail), selfEdit.id);

    const moderator = await roleService.create({ name: moderatorRoleName });
    await roleService.setPermissionsForRole(moderator.id, [
      { permissionId: updateUser.id }
    ]);
    await roleService.assignRoleToUser(
      await userId(moderatorEmail),
      moderator.id
    );
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(Role)
      .delete({ name: In([selfEditRoleName, moderatorRoleName]) });
    await dataSource
      ?.getRepository(User)
      .delete([{ email: ownerEmail }, { email: moderatorEmail }]);
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

  async function tokenFor(email: string): Promise<string> {
    const user = await usersService.findOne(await userId(email));
    const { tokens } = await authService.login(user, 'moderation-self-e2e');
    return tokens.access_token;
  }

  function patch(token: string, id: string, body: object) {
    return request(http())
      .patch(`/api/v1/users/${id}`)
      .auth(token, { type: 'bearer' })
      .send(body);
  }

  function row(id: string): Promise<User> {
    return dataSource.getRepository(User).findOneOrFail({ where: { id } });
  }

  it('refuses a deactivation of the own record and keeps the row active', async () => {
    const id = await userId(ownerEmail);

    const res = await patch(await tokenFor(ownerEmail), id, {
      isActive: false
    });

    expect(res.status).toBe(400);
    expect((res.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.USERS.MODERATION_SELF
    );
    expect((await row(id)).isActive).toBe(true);
  }, 30000);

  it('refuses an unlock of the own record and keeps the lock', async () => {
    const id = await userId(ownerEmail);
    const token = await tokenFor(ownerEmail);
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    await dataSource
      .getRepository(User)
      .update(id, { failedLoginAttempts: 5, lockedUntil });

    const res = await patch(token, id, { unlockAccount: true });

    expect(res.status).toBe(400);
    expect((res.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.USERS.MODERATION_SELF
    );
    const after = await row(id);
    expect(after.failedLoginAttempts).toBe(5);
    expect(after.lockedUntil?.getTime()).toBe(lockedUntil.getTime());

    await dataSource
      .getRepository(User)
      .update(id, { failedLoginAttempts: 0, lockedUntil: null });
  }, 30000);

  it('keeps a name edit of the own record open', async () => {
    const id = await userId(ownerEmail);

    await patch(await tokenFor(ownerEmail), id, {
      firstName: 'Renamed'
    }).expect(200);

    expect((await row(id)).firstName).toBe('Renamed');
  }, 30000);

  it('lets an unconditional update:User holder deactivate another account', async () => {
    const id = await userId(ownerEmail);

    const res = await patch(await tokenFor(moderatorEmail), id, {
      isActive: false
    });

    expect(res.status).toBe(200);
    expect((res.body as { isActive: boolean }).isActive).toBe(false);
    expect((await row(id)).isActive).toBe(false);
  }, 30000);
});
