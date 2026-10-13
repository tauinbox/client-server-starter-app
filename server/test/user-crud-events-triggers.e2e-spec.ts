import { randomBytes, randomUUID } from 'crypto';
import { get, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { Response } from 'express';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, In } from 'typeorm';
import type { NotificationEvent } from '@app/shared/types';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthController } from '../src/modules/auth/controllers/auth.controller';
import { RolesController } from '../src/modules/auth/controllers/roles.controller';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
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
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { hashToken } from '../src/common/utils/hash-token';
import { eventually } from './eventually';

// Every write that changes a column of the admin user list must reach the
// viewers of that list, not only the writes of the admin user routes. Real
// services, real ability resolution and the real stream of each viewer.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

type ListEvent = Extract<
  NotificationEvent,
  { type: 'user_crud_events' | 'user_list_stale' }
>;

runWithInfra(
  'user list events for writes outside the admin routes (e2e)',
  () => {
    const tag = `crud-events-triggers-${Date.now()}`;
    const emails = {
      viewer: `${tag}-viewer@example.com`,
      plain: `${tag}-plain@example.com`,
      target: `${tag}-target@example.com`,
      mover: `${tag}-mover@example.com`,
      registered: `${tag}-registered@example.com`,
      provider: `${tag}-provider@example.com`,
      moved: `${tag}-moved@example.com`
    };
    const roleNames = [
      `${tag}-viewer`,
      `${tag}-extra`,
      `${tag}-renamed`,
      `${tag}-doomed`
    ];

    let app: INestApplication;
    let dataSource: DataSource;
    let authService: AuthService;
    let usersService: UsersService;
    let roleService: RoleService;
    let rolesController: RolesController;
    let port: number;
    let viewer: User;
    let plain: User;
    let target: User;
    const pushes: Promise<void>[] = [];
    const requests: { destroy: () => void }[] = [];

    const saveUser = (email: string, extra: Partial<User> = {}) => {
      const repository = dataSource.getRepository(User);
      return repository.save(
        repository.create({
          email,
          firstName: 'Crud',
          lastName: 'Trigger',
          isEmailVerified: true,
          password: null,
          ...extra
        })
      );
    };

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
      roleService = app.get(RoleService);
      rolesController = app.get(RolesController);

      jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
      jest
        .spyOn(app.get(AuditService), 'logFireAndForget')
        .mockImplementation(() => undefined);

      const notifications = app.get(NotificationsService);
      const pushToAuthorized =
        notifications.pushToAuthorized.bind(notifications);
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

      viewer = await saveUser(emails.viewer);
      plain = await saveUser(emails.plain);
      target = await saveUser(emails.target);
      const viewerRole = await roleService.create({ name: `${tag}-viewer` });
      await roleService.setPermissionsForRole(viewerRole.id, [
        { permissionId: searchUser.id }
      ]);
      await roleService.assignRoleToUser(viewer.id, viewerRole.id);
    }, 60000);

    afterAll(async () => {
      for (const req of requests) req.destroy();
      if (dataSource) {
        await dataSource.getRepository(Role).delete({ name: In(roleNames) });
        await dataSource
          .getRepository(User)
          .delete({ email: In(Object.values(emails)) });
      }
      await app?.close();
    });

    async function openStream(user: User): Promise<() => ListEvent[]> {
      const { tokens } = await authService.login(
        await usersService.findOne(user.id),
        { userAgent: 'crud-events-triggers-e2e', ipAddress: '203.0.113.11' }
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
                  (event): event is ListEvent =>
                    event.type === 'user_crud_events' ||
                    event.type === 'user_list_stale'
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

    const requestOf = (userId: string): JwtAuthRequest => {
      const req = {
        user: {
          userId,
          email: 'actor@example.com',
          roles: [],
          sessionId: randomUUID()
        },
        ip: '127.0.0.1',
        headers: {},
        cookies: {}
      };
      // @ts-expect-error partial request: the handlers read only these fields
      return req;
    };

    // Waits until the stream holds `count` frames, then until every push has
    // ended, so that a missing or an extra frame is an answer.
    const settle = async (read: () => ListEvent[], count: number) => {
      await eventually(
        () => Promise.resolve(read().length >= count ? true : null),
        5000
      );
      await Promise.all(pushes);
    };

    const crud = (
      action: 'created' | 'updated',
      userId: string
    ): ListEvent => ({ type: 'user_crud_events', action, userId });

    it('sends created for a self-registration and a provider sign-up', async () => {
      const stream = await openStream(viewer);

      await authService.register({
        email: emails.registered,
        password: 'Sunrise-Kettle-19',
        firstName: 'Self',
        lastName: 'Registered'
      });
      await app.get(OAuthService).loginWithOAuth({
        provider: 'vk',
        providerId: `vk-${randomBytes(6).toString('hex')}`,
        email: emails.provider,
        firstName: 'Provider',
        lastName: 'Signup',
        emailVerified: true
      });

      const registered = await usersService.findByEmail(emails.registered);
      const provider = await usersService.findByEmail(emails.provider);
      await settle(stream, 2);
      expect(stream()).toEqual([
        crud('created', registered!.id),
        crud('created', provider!.id)
      ]);
    }, 30000);

    it('sends updated for a role assign and a role remove', async () => {
      const stream = await openStream(viewer);
      const extra = await roleService.create({ name: `${tag}-extra` });
      const req = requestOf(randomUUID());

      await rolesController.assignRole(
        target.id,
        { roleId: extra.id },
        superAbility(),
        req
      );
      await rolesController.removeRole(
        target.id,
        extra.id,
        superAbility(),
        req
      );

      await settle(stream, 2);
      const updated = crud('updated', target.id);
      expect(stream()).toEqual([updated, updated]);
    }, 30000);

    it('sends updated for an own name change and not for a locale change', async () => {
      const stream = await openStream(viewer);
      const authController = app.get(AuthController);
      // The handler writes no cookie for a change without a password.
      const res = {} as Response;

      await authController.updateProfile(
        requestOf(target.id),
        { locale: 'ru' },
        res
      );
      await authController.updateProfile(
        requestOf(target.id),
        { lastName: 'Renamed' },
        res
      );

      await settle(stream, 1);
      expect(stream()).toEqual([crud('updated', target.id)]);
    }, 30000);

    it('sends updated for a confirmed email change', async () => {
      const stream = await openStream(viewer);
      const rawToken = randomBytes(32).toString('hex');
      const mover = await saveUser(emails.mover, {
        pendingEmail: emails.moved,
        pendingEmailToken: hashToken(rawToken),
        pendingEmailExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });

      await authService.confirmEmailChange(rawToken);

      await settle(stream, 1);
      expect(stream()).toEqual([crud('updated', mover.id)]);
    }, 30000);

    it('sends user_list_stale after a role rename and a role delete, only to list viewers', async () => {
      const stream = await openStream(viewer);
      const plainStream = await openStream(plain);
      const renamed = await roleService.create({ name: `${tag}-doomed` });
      const req = requestOf(randomUUID());

      await rolesController.update(
        renamed.id,
        { name: `${tag}-renamed` },
        req,
        superAbility()
      );
      await rolesController.remove(renamed.id, req, superAbility());

      const stale: ListEvent = { type: 'user_list_stale' };
      await settle(stream, 2);
      expect(stream()).toEqual([stale, stale]);
      expect(plainStream()).toEqual([]);
    }, 30000);
  }
);
