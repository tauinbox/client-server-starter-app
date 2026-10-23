import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource, In } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { withPrivateThrottlerStorage } from './private-throttler';

// A conditional `update` grant scoped by a field that the body can write is
// checked on the record before AND after the write: else the caller moves the
// record out of its own scope.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra(
  'PATCH of a field that a conditional update grant reads (e2e)',
  () => {
    let app: INestApplication;
    let dataSource: DataSource;
    let authService: AuthService;
    let usersService: UsersService;
    const stamp = Date.now();
    const actorRoleName = `post-image-actor-${stamp}`;
    const teamA = `post-image-team-a-${stamp}`;
    const teamB = `post-image-team-b-${stamp}`;
    const actorEmail = `post-image-actor-${stamp}@example.com`;
    const targetEmail = `post-image-target-${stamp}@example.com`;
    const resourceLabel = `Post image ${stamp}`;
    const password = 'Lantern-Orchard-47';
    let resource: Resource;

    beforeAll(async () => {
      const moduleRef: TestingModule = await withPrivateThrottlerStorage(
        Test.createTestingModule({ imports: [CoreModule.forRoot()] })
      ).compile();

      const expressApp =
        moduleRef.createNestApplication<NestExpressApplication>(
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

      await request(http())
        .post('/api/v1/auth/register')
        .send({
          email: actorEmail,
          password,
          firstName: 'Post',
          lastName: 'Actor'
        })
        .expect(201);
      await request(http())
        .post('/api/v1/auth/register')
        .send({
          email: targetEmail,
          password,
          firstName: 'Post',
          lastName: 'Alpha'
        })
        .expect(201);

      // A row of its own, so the grant scope touches no shared resource.
      const resourceRepository = dataSource.getRepository(Resource);
      resource = await resourceRepository.save(
        resourceRepository.create({
          name: `post-image-${stamp}`,
          subject: `PostImage${stamp}`,
          displayName: resourceLabel,
          actionNames: ['read'],
          conditionalActionNames: [],
          allowedActionNames: null
        })
      );

      const roleService = app.get(RoleService);
      const permissions = await dataSource.getRepository(Permission).find();
      const permissionId = (subject: string): string => {
        const found = permissions.find(
          (p) => p.action.name === 'update' && p.resource.subject === subject
        );
        if (!found) throw new Error(`Permission update:${subject} missing`);
        return found.id;
      };

      await roleService.create({ name: teamA }, SYSTEM_ABILITY);
      const actorRole = await roleService.create(
        { name: actorRoleName },
        SYSTEM_ABILITY
      );
      await roleService.setPermissionsForRole(
        actorRole.id,
        [
          {
            permissionId: permissionId('User'),
            conditions: { fieldMatch: { lastName: ['Alpha'] } }
          },
          {
            permissionId: permissionId('Role'),
            conditions: { fieldMatch: { name: [teamA] } }
          },
          {
            permissionId: permissionId('Permission'),
            conditions: { fieldMatch: { displayName: [resourceLabel] } }
          }
        ],
        SYSTEM_ABILITY
      );
      await roleService.assignRoleToUser(
        await userId(actorEmail),
        actorRole.id,
        SYSTEM_ABILITY
      );
    }, 60000);

    afterAll(async () => {
      if (resource) {
        await dataSource?.getRepository(Resource).delete({ id: resource.id });
      }
      await dataSource
        ?.getRepository(Role)
        .delete({ name: In([actorRoleName, teamA, teamB]) });
      await dataSource
        ?.getRepository(User)
        .delete([{ email: actorEmail }, { email: targetEmail }]);
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

    async function token(): Promise<string> {
      const user = await usersService.findOne(
        await userId(actorEmail),
        SYSTEM_ABILITY
      );
      const { tokens } = await authService.login(user, {
        userAgent: 'post-image-e2e',
        ipAddress: null
      });
      return tokens.access_token;
    }

    async function patch(path: string, body: object) {
      return request(http())
        .patch(`/api/v1/${path}`)
        .auth(await token(), { type: 'bearer' })
        .send(body);
    }

    async function roleId(name: string): Promise<string> {
      const found = await dataSource
        .getRepository(Role)
        .findOneOrFail({ where: { name } });
      return found.id;
    }

    describe('PATCH /users/:id', () => {
      it('refuses a write that moves the user out of the scope', async () => {
        const id = await userId(targetEmail);

        const res = await patch(`users/${id}`, { lastName: 'Beta' });

        expect(res.status).toBe(403);
        const row = await dataSource
          .getRepository(User)
          .findOneOrFail({ where: { id } });
        expect(row.lastName).toBe('Alpha');
      }, 30000);

      it('allows a write that keeps the user in the scope', async () => {
        const id = await userId(targetEmail);

        const res = await patch(`users/${id}`, {
          firstName: 'Renamed',
          lastName: 'Alpha'
        });

        expect(res.status).toBe(200);
        expect((res.body as { firstName: string }).firstName).toBe('Renamed');
      }, 30000);
    });

    describe('PATCH /roles/:id', () => {
      it('refuses a rename that moves the role out of the scope', async () => {
        const id = await roleId(teamA);

        const res = await patch(`roles/${id}`, { name: teamB });

        expect(res.status).toBe(403);
        const row = await dataSource
          .getRepository(Role)
          .findOneOrFail({ where: { id } });
        expect(row.name).toBe(teamA);
      }, 30000);

      it('allows a write that keeps the role in the scope', async () => {
        const id = await roleId(teamA);

        const res = await patch(`roles/${id}`, { description: 'Edited' });

        expect(res.status).toBe(200);
      }, 30000);
    });

    describe('PATCH /rbac/resources/:id', () => {
      it('refuses a write that moves the resource out of the scope', async () => {
        const res = await patch(`rbac/resources/${resource.id}`, {
          displayName: 'Moved'
        });

        expect(res.status).toBe(403);
        const row = await dataSource
          .getRepository(Resource)
          .findOneOrFail({ where: { id: resource.id } });
        expect(row.displayName).toBe(resourceLabel);
      }, 30000);

      it('allows a write that keeps the resource in the scope', async () => {
        const res = await patch(`rbac/resources/${resource.id}`, {
          description: 'Edited'
        });

        expect(res.status).toBe(200);
      }, 30000);
    });
  }
);
