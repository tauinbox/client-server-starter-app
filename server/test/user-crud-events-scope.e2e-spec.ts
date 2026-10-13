import { randomUUID } from 'crypto';
import { get, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, In } from 'typeorm';
import type { NotificationEvent } from '@app/shared/types';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import {
  AbilityBuilder,
  createMongoAbility,
  type AppAbility
} from '../src/modules/auth/casl/app-ability';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { UsersController } from '../src/modules/users/controllers/users.controller';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { eventually } from './eventually';

// The user list applies the conditions of a `search:User` grant in SQL, so the
// push of a user change must apply them too. Real roles, real ability
// resolution and the real stream of each viewer.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

type UserCrudEvent = Extract<NotificationEvent, { type: 'user_crud_events' }>;

runWithInfra('user_crud_events follow the search:User grant (e2e)', () => {
  const tag = `crud-events-scope-${Date.now()}`;
  const emails = {
    scoped: `${tag}-scoped@example.com`,
    wide: `${tag}-wide@example.com`,
    activeOnly: `${tag}-active-only@example.com`,
    other: `${tag}-other@example.com`
  };

  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  let usersController: UsersController;
  let port: number;
  const users = {} as Record<keyof typeof emails, User>;
  const pushes: Promise<void>[] = [];
  const requests: { destroy: () => void }[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0);
    port = ((app.getHttpServer() as Server).address() as AddressInfo).port;

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    usersService = app.get(UsersService);
    usersController = app.get(UsersController);
    const roleService = app.get(RoleService);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    // Each push is awaited before an assertion, so a missing frame is an
    // answer and not a slow delivery.
    const notifications = app.get(NotificationsService);
    const pushToAuthorized = notifications.pushToAuthorized.bind(notifications);
    jest
      .spyOn(notifications, 'pushToAuthorized')
      .mockImplementation((event, allows) => {
        const push = pushToAuthorized(event, allows);
        pushes.push(push);
        return push;
      });

    const searchUser = await dataSource.getRepository(Permission).findOne({
      where: { action: { name: 'search' }, resource: { subject: 'User' } },
      relations: { action: true, resource: true }
    });
    if (!searchUser) throw new Error('Permission search:User missing');

    const repository = dataSource.getRepository(User);
    for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
      users[key] = await repository.save(
        repository.create({
          email: emails[key],
          firstName: 'Crud',
          lastName: key,
          isEmailVerified: true,
          password: null
        })
      );
    }

    const scopedRole = await roleService.create({ name: `${tag}-scoped` });
    await roleService.setPermissionsForRole(scopedRole.id, [
      {
        permissionId: searchUser.id,
        conditions: { ownership: { userField: 'id' } }
      }
    ]);
    await roleService.assignRoleToUser(users.scoped.id, scopedRole.id);

    const wideRole = await roleService.create({ name: `${tag}-wide` });
    await roleService.setPermissionsForRole(wideRole.id, [
      { permissionId: searchUser.id }
    ]);
    await roleService.assignRoleToUser(users.wide.id, wideRole.id);

    const activeRole = await roleService.create({ name: `${tag}-active` });
    await roleService.setPermissionsForRole(activeRole.id, [
      {
        permissionId: searchUser.id,
        conditions: { fieldMatch: { isActive: [true] } }
      }
    ]);
    await roleService.assignRoleToUser(users.activeOnly.id, activeRole.id);
  }, 60000);

  afterAll(async () => {
    for (const req of requests) req.destroy();
    if (dataSource) {
      await dataSource.getRepository(Role).delete({
        name: In([`${tag}-scoped`, `${tag}-wide`, `${tag}-active`])
      });
      await dataSource
        .getRepository(User)
        .delete({ email: In(Object.values(emails)) });
    }
    await app?.close();
  });

  async function openStream(user: User): Promise<() => UserCrudEvent[]> {
    const { tokens } = await authService.login(
      await usersService.findOne(user.id),
      { userAgent: 'crud-events-e2e', ipAddress: '203.0.113.10' }
    );
    return new Promise((resolve, reject) => {
      const req = get(
        {
          port,
          path: '/api/v1/notifications/stream',
          headers: { authorization: `Bearer ${tokens.access_token}` }
        },
        (res: IncomingMessage) => {
          if (res.statusCode !== 200) {
            reject(new Error(`stream status ${res.statusCode}`));
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('error', () => undefined);
          resolve(() =>
            body
              .split('\n')
              .filter((line) => line.startsWith('data: {'))
              .map((line) => JSON.parse(line.slice(6)) as NotificationEvent)
              .filter(
                (event): event is UserCrudEvent =>
                  event.type === 'user_crud_events'
              )
          );
        }
      );
      req.on('error', () => undefined);
      requests.push(req);
    });
  }

  const superAbility = (): AppAbility => {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can('manage', 'all');
    return build();
  };

  const adminRequest = (): JwtAuthRequest => {
    const req = {
      user: {
        userId: randomUUID(),
        email: 'admin@example.com',
        roles: [],
        sessionId: randomUUID()
      },
      ip: '127.0.0.1',
      headers: {}
    };
    // @ts-expect-error partial request: the handlers read only these fields
    return req;
  };

  const settle = async (count: number): Promise<void> => {
    await eventually(
      () => Promise.resolve(pushes.length >= count ? true : null),
      5000
    );
    await Promise.all(pushes);
  };

  const frame = async (
    read: () => UserCrudEvent[],
    event: UserCrudEvent
  ): Promise<void> => {
    await eventually(
      () =>
        Promise.resolve(
          read().some((e) => JSON.stringify(e) === JSON.stringify(event))
            ? true
            : null
        ),
      2000
    );
    expect(read()).toContainEqual(event);
  };

  it('sends each event only to the viewers whose list shows the user', async () => {
    const scoped = await openStream(users.scoped);
    const wide = await openStream(users.wide);
    const other = users.other.id;
    const own = users.scoped.id;

    await usersController.update(
      other,
      { firstName: 'Changed' },
      adminRequest(),
      superAbility()
    );
    await usersController.remove(other, adminRequest(), superAbility());
    await usersController.restore(other, adminRequest(), superAbility());
    await usersController.update(
      own,
      { firstName: 'Own' },
      adminRequest(),
      superAbility()
    );
    await settle(4);

    const ownUpdate: UserCrudEvent = {
      type: 'user_crud_events',
      action: 'updated',
      userId: own
    };
    for (const action of ['updated', 'deleted', 'restored'] as const) {
      await frame(wide, { type: 'user_crud_events', action, userId: other });
    }
    await frame(wide, ownUpdate);
    await frame(scoped, ownUpdate);
    expect(scoped()).toEqual([ownUpdate]);
  }, 30000);

  it('sends an update to a viewer whose list showed the user before the change', async () => {
    const activeOnly = await openStream(users.activeOnly);
    const other = users.other.id;
    const before = pushes.length;

    await usersController.update(
      other,
      { isActive: false },
      adminRequest(),
      superAbility()
    );
    await usersController.update(
      other,
      { firstName: 'Inactive' },
      adminRequest(),
      superAbility()
    );
    await settle(before + 2);

    const left: UserCrudEvent = {
      type: 'user_crud_events',
      action: 'updated',
      userId: other
    };
    await frame(activeOnly, left);
    expect(activeOnly()).toEqual([left]);
  }, 30000);
});
