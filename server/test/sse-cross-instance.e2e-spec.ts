import { randomUUID } from 'crypto';
import { get, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { DataSource, In } from 'typeorm';
import type { NotificationEvent } from '@app/shared/types';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { NotificationsBus } from '../src/modules/notifications/notifications-bus';
import { RedisNotificationsBus } from '../src/modules/notifications/redis-notifications-bus';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { eventually } from './eventually';

const REDIS_URL = process.env['REDIS_URL'];

// Two app instances on one database and one Redis: a push raised on one
// instance must reach the streams held by the other. Real Redis pub/sub,
// real ability resolution and real streams.
const runWithRedis =
  REDIS_URL && process.env['DB_HOST'] ? describe : describe.skip;

runWithRedis('server pushes across instances (e2e)', () => {
  const tag = `sse-cross-instance-${Date.now()}`;
  const namespace = `${tag}:${randomUUID()}`;
  const emails = {
    viewer: `${tag}-viewer@example.com`,
    plain: `${tag}-plain@example.com`,
    idle: `${tag}-idle@example.com`
  };
  const roleName = `${tag}-viewer`;

  let first: INestApplication;
  let second: INestApplication;
  let redis: Redis;
  let viewer: User;
  let plain: User;
  let idle: User;
  let role: Role;
  let searchUser: Permission;
  const requests: { destroy: () => void }[] = [];

  const startInstance = async (): Promise<INestApplication> => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    })
      .overrideProvider(NotificationsBus)
      .useFactory({
        factory: () => new RedisNotificationsBus(REDIS_URL ?? '', namespace)
      })
      .compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0);
    return app;
  };

  beforeAll(async () => {
    redis = new Redis(REDIS_URL ?? '');
    first = await startInstance();
    second = await startInstance();

    const dataSource = first.get(DataSource);
    const repository = dataSource.getRepository(User);
    const saveUser = (email: string) =>
      repository.save(
        repository.create({
          email,
          firstName: 'Cross',
          lastName: 'Instance',
          isEmailVerified: true,
          password: null
        })
      );
    viewer = await saveUser(emails.viewer);
    plain = await saveUser(emails.plain);
    idle = await saveUser(emails.idle);

    const permission = await dataSource.getRepository(Permission).findOne({
      where: { action: { name: 'search' }, resource: { subject: 'User' } },
      relations: { action: true, resource: true }
    });
    if (!permission) throw new Error('Permission search:User missing');
    searchUser = permission;
    const roleService = first.get(RoleService);
    role = await roleService.create({ name: roleName });
    await roleService.setPermissionsForRole(role.id, [
      { permissionId: searchUser.id }
    ]);
    await roleService.assignRoleToUser(viewer.id, role.id);
    await roleService.assignRoleToUser(idle.id, role.id);

    // Both instances listen before any push is raised.
    const channel = `${namespace}:push:${redis.options.db ?? 0}`;
    await eventually(async () => {
      const [, count] = (await redis.pubsub('NUMSUB', channel)) as [
        string,
        number
      ];
      return count === 2 ? true : null;
    });
  }, 60000);

  afterAll(async () => {
    for (const req of requests) req.destroy();
    if (first) {
      const dataSource = first.get(DataSource);
      await dataSource.getRepository(Role).delete({ name: roleName });
      await dataSource
        .getRepository(User)
        .delete({ email: In(Object.values(emails)) });
    }
    await first?.close();
    await second?.close();
    await redis?.del(`${namespace}:users`);
    await redis?.quit();
  });

  async function openStream(
    app: INestApplication,
    user: User
  ): Promise<() => NotificationEvent[]> {
    const usersService = app.get(UsersService);
    const { tokens } = await app
      .get(AuthService)
      .login(await usersService.findOne(user.id), {
        userAgent: 'sse-cross-instance-e2e',
        ipAddress: '203.0.113.12'
      });
    const port = ((app.getHttpServer() as Server).address() as AddressInfo)
      .port;
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
          );
        }
      );
      req.on('error', () => undefined);
      requests.push(req);
    });
  }

  const settle = async (read: () => NotificationEvent[], count: number) => {
    await eventually(() => Promise.resolve(read().length >= count || null));
    // Room for a frame that must not come.
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  it('delivers push, pushToAll and pushToAuthorized to the streams of the other instance', async () => {
    const viewerOnSecond = await openStream(second, viewer);
    const plainOnSecond = await openStream(second, plain);
    const viewerOnFirst = await openStream(first, viewer);
    const notifications = first.get(NotificationsService);

    // The first instance must see the users of the second in the registry.
    await eventually(async () => {
      const userIds = await first.get(NotificationsBus).connectedUserIds();
      return userIds?.includes(viewer.id) && userIds.includes(plain.id)
        ? true
        : null;
    });

    const direct = { type: 'session_invalidated' } as const;
    const broadcast = { type: 'feature_flags_updated' } as const;
    const authorized = {
      type: 'user_crud_events',
      action: 'created',
      userId: randomUUID()
    } as const;

    notifications.push(plain.id, direct);
    notifications.pushToAll(broadcast);
    await notifications.pushToAuthorized(
      authorized,
      (ability) => ability.can('search', 'User'),
      { action: 'search', subject: 'User' }
    );

    await settle(viewerOnSecond, 2);
    await settle(plainOnSecond, 2);
    expect(viewerOnSecond()).toEqual([broadcast, authorized]);
    expect(plainOnSecond()).toEqual([direct, broadcast]);
    // The sending instance delivers once, not again from its own message.
    expect(viewerOnFirst()).toEqual([broadcast, authorized]);
  });

  it('sends a role permission change to the connected holders only, in one message', async () => {
    const viewerOnSecond = await openStream(second, viewer);
    await eventually(async () => {
      const userIds = await first.get(NotificationsBus).connectedUserIds();
      return userIds?.includes(viewer.id) ? true : null;
    });
    const listener = redis.duplicate();
    const messages: { userIds?: string[]; event: NotificationEvent }[] = [];
    listener.on('message', (_channel: string, raw: string) => {
      messages.push(
        JSON.parse(raw) as { userIds?: string[]; event: NotificationEvent }
      );
    });
    await listener.subscribe(`${namespace}:push:${redis.options.db ?? 0}`);

    try {
      await first
        .get(RoleService)
        .setPermissionsForRole(role.id, [{ permissionId: searchUser.id }]);

      await settle(viewerOnSecond, 1);
      expect(viewerOnSecond()).toEqual([{ type: 'permissions_updated' }]);
      expect(messages).toEqual([
        expect.objectContaining({
          userIds: [viewer.id],
          event: { type: 'permissions_updated' }
        })
      ]);
    } finally {
      await listener.quit();
    }
  });
});
