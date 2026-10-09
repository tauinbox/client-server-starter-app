import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { ResourceService } from '../src/modules/auth/services/resource.service';
import { ResourceRegistryService } from '../src/modules/auth/services/resource-registry.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// An administrator change to a role, a role grant or a resource and its audit
// row commit together: when the row cannot be written, the request fails and
// nothing changes.
// CI runs the migrations and not the seeders; the super role comes from them.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra(
  'Role and resource changes: audit in the write transaction (e2e)',
  () => {
    let app: INestApplication;
    let dataSource: DataSource;
    let usersService: UsersService;
    let authService: AuthService;
    let roleService: RoleService;
    let token: string;
    const stamp = Date.now();
    const prefix = `role-audit-tx-${stamp}`;
    const adminEmail = `${prefix}-admin@example.com`;
    const targetEmail = `${prefix}-target@example.com`;
    const password = 'Lantern-Orchard-47';
    const resourceName = `${prefix}-resource`;
    let targetId: string;
    let heldRole: Role;
    let freeRole: Role;
    let firstPermissionId: string;
    let secondPermissionId: string;
    let resourceId: string;

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
      usersService = app.get(UsersService);
      authService = app.get(AuthService);
      roleService = app.get(RoleService);

      const names = { firstName: 'Role', lastName: 'Tx' };
      const admin = await usersService.create({
        email: adminEmail,
        password,
        ...names
      });
      targetId = (
        await usersService.create({ email: targetEmail, password, ...names })
      ).id;

      const superRole = await dataSource
        .getRepository(Role)
        .findOneByOrFail({ isSuper: true });
      await roleService.assignRoleToUser(admin.id, superRole.id);
      token = await sessionOf(admin.id);

      const permissions = await dataSource.getRepository(Permission).find();
      const readOf = (subject: string) =>
        permissions.find(
          (p) => p.resource.subject === subject && p.action.name === 'read'
        )!.id;
      firstPermissionId = readOf('Role');
      secondPermissionId = readOf('Permission');

      heldRole = await roleService.create({ name: `${prefix}-held` });
      freeRole = await roleService.create({ name: `${prefix}-free` });
      await roleService.setPermissionsForRole(heldRole.id, [
        { permissionId: firstPermissionId }
      ]);
      await roleService.assignRoleToUser(targetId, heldRole.id);

      resourceId = (
        await dataSource.getRepository(Resource).save({
          name: resourceName,
          subject: `RoleAuditTx${stamp}`,
          displayName: 'Role audit tx',
          isOrphaned: true
        })
      ).id;
    }, 60000);

    beforeEach(async () => {
      await sessionOf(targetId);
      jest
        .spyOn(app.get(ResourceRegistryService), 'isRegistered')
        .mockImplementation((name) => name === resourceName);
      jest
        .spyOn(app.get(AuditService), 'log')
        .mockRejectedValue(new Error('audit down'));
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      if (dataSource) {
        await dataSource
          .getRepository(User)
          .delete([{ email: adminEmail }, { email: targetEmail }]);
        await dataSource
          .createQueryBuilder()
          .delete()
          .from(Role)
          .where('name LIKE :prefix', { prefix: `${prefix}%` })
          .execute();
        await dataSource.getRepository(Resource).delete({ name: resourceName });
        await app.get(ResourceService).invalidateSubjectMapCache();
      }
      await app?.close();
    });

    function http(): Server {
      return app.getHttpServer() as Server;
    }

    function api() {
      const agent = request(http());
      return {
        post: (url: string) =>
          agent.post(`/api/v1${url}`).auth(token, { type: 'bearer' }),
        put: (url: string) =>
          agent.put(`/api/v1${url}`).auth(token, { type: 'bearer' }),
        patch: (url: string) =>
          agent.patch(`/api/v1${url}`).auth(token, { type: 'bearer' }),
        delete: (url: string) =>
          agent.delete(`/api/v1${url}`).auth(token, { type: 'bearer' })
      };
    }

    async function sessionOf(id: string): Promise<string> {
      const { tokens } = await authService.login(
        await usersService.findOne(id),
        {
          userAgent: 'role-audit-tx-e2e',
          ipAddress: null
        }
      );
      return tokens.access_token;
    }

    function role(id: string): Promise<Role | null> {
      return dataSource.getRepository(Role).findOneBy({ id });
    }

    async function grantedIds(roleId: string): Promise<string[]> {
      const rows = await dataSource
        .getRepository(RolePermission)
        .findBy({ roleId });
      return rows.map((row) => row.permissionId).sort();
    }

    async function holds(userId: string, roleId: string): Promise<boolean> {
      const rows: unknown[] = await dataSource.query(
        'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2',
        [userId, roleId]
      );
      return rows.length > 0;
    }

    function sessions(id: string): Promise<number> {
      return dataSource
        .getRepository(RefreshToken)
        .count({ where: { userId: id } });
    }

    function resource(): Promise<Resource> {
      return dataSource.getRepository(Resource).findOneByOrFail({
        id: resourceId
      });
    }

    it('create answers 500 and stores no role', async () => {
      const name = `${prefix}-created`;
      await api().post('/roles').send({ name }).expect(500);

      expect(await dataSource.getRepository(Role).countBy({ name })).toBe(0);
    });

    it('an update answers 500 and keeps the description', async () => {
      await api()
        .patch(`/roles/${heldRole.id}`)
        .send({ description: 'changed' })
        .expect(500);

      expect((await role(heldRole.id))?.description).toBeNull();
    });

    it('a rename answers 500 and keeps the name', async () => {
      await api()
        .patch(`/roles/${heldRole.id}`)
        .send({ name: `${prefix}-renamed` })
        .expect(500);

      expect((await role(heldRole.id))?.name).toBe(heldRole.name);
    });

    it('delete answers 500 and keeps the role', async () => {
      await api().delete(`/roles/${heldRole.id}`).expect(500);

      expect(await role(heldRole.id)).not.toBeNull();
    });

    it('a permission set answers 500 and keeps the grants', async () => {
      await api()
        .put(`/roles/${heldRole.id}/permissions`)
        .send({ items: [{ permissionId: secondPermissionId }] })
        .expect(500);

      expect(await grantedIds(heldRole.id)).toEqual([firstPermissionId]);
    });

    it('a permission add answers 500 and adds no grant', async () => {
      await api()
        .post(`/roles/${heldRole.id}/permissions`)
        .send({ permissionIds: [secondPermissionId] })
        .expect(500);

      expect(await grantedIds(heldRole.id)).toEqual([firstPermissionId]);
    });

    it('a permission remove answers 500 and keeps the grant', async () => {
      await api()
        .delete(`/roles/${heldRole.id}/permissions/${firstPermissionId}`)
        .expect(500);

      expect(await grantedIds(heldRole.id)).toEqual([firstPermissionId]);
    });

    it('a role assignment answers 500, assigns nothing and ends no session', async () => {
      await api()
        .post(`/roles/assign/${targetId}`)
        .send({ roleId: freeRole.id })
        .expect(500);

      expect(await holds(targetId, freeRole.id)).toBe(false);
      expect(await sessions(targetId)).toBeGreaterThan(0);
    });

    it('a role removal answers 500, keeps the role and ends no session', async () => {
      await api()
        .delete(`/roles/assign/${targetId}/${heldRole.id}`)
        .expect(500);

      expect(await holds(targetId, heldRole.id)).toBe(true);
      expect(await sessions(targetId)).toBeGreaterThan(0);
    });

    it('a resource update answers 500 and keeps the display name', async () => {
      await api()
        .patch(`/rbac/resources/${resourceId}`)
        .send({ displayName: 'Changed' })
        .expect(500);

      expect((await resource()).displayName).toBe('Role audit tx');
    });

    it('a resource restore answers 500 and keeps the resource orphaned', async () => {
      await api().post(`/rbac/resources/${resourceId}/restore`).expect(500);

      expect((await resource()).isOrphaned).toBe(true);
    });

    it('with a working audit, each change writes one row with its details', async () => {
      jest.mocked(app.get(AuditService).log).mockRestore();

      const name = `${prefix}-working`;
      const created = await api().post('/roles').send({ name }).expect(201);
      const id = (created.body as { id: string }).id;
      await api()
        .patch(`/roles/${id}`)
        .send({ description: 'working' })
        .expect(200);
      await api()
        .put(`/roles/${id}/permissions`)
        .send({ items: [{ permissionId: firstPermissionId }] })
        .expect(200);
      await api()
        .post(`/roles/${id}/permissions`)
        .send({ permissionIds: [secondPermissionId] })
        .expect(201);
      await api()
        .delete(`/roles/${id}/permissions/${secondPermissionId}`)
        .expect(200);
      await api()
        .post(`/roles/assign/${targetId}`)
        .send({ roleId: id })
        .expect(201);
      await api().delete(`/roles/assign/${targetId}/${id}`).expect(200);
      await api().delete(`/roles/${id}`).expect(200);
      await api()
        .patch(`/rbac/resources/${resourceId}`)
        .send({ displayName: 'Working' })
        .expect(200);
      await api().post(`/rbac/resources/${resourceId}/restore`).expect(200);

      const rows = await dataSource
        .getRepository(AuditLog)
        .findBy({ actorEmail: adminEmail });
      const shape = (row: AuditLog) => ({
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        details: row.details,
        hasIp: row.ipAddress !== null
      });
      const row = (
        action: AuditAction,
        targetType: string,
        targetId: string,
        details: Record<string, unknown> | null
      ) => ({ action, targetType, targetId, details, hasIp: true });

      expect(rows.map(shape)).toHaveLength(10);
      expect(rows.map(shape)).toEqual(
        expect.arrayContaining([
          row(AuditAction.ROLE_CREATE, 'Role', id, { name }),
          row(AuditAction.ROLE_UPDATE, 'Role', id, {
            changedFields: ['description']
          }),
          row(AuditAction.PERMISSION_ASSIGN, 'Role', id, {
            permissionIds: [firstPermissionId]
          }),
          row(AuditAction.PERMISSION_ASSIGN, 'Role', id, {
            permissionIds: [secondPermissionId]
          }),
          row(AuditAction.PERMISSION_UNASSIGN, 'Role', id, {
            permissionId: secondPermissionId
          }),
          row(AuditAction.ROLE_ASSIGN, 'User', targetId, { roleId: id }),
          row(AuditAction.ROLE_UNASSIGN, 'User', targetId, { roleId: id }),
          row(AuditAction.ROLE_DELETE, 'Role', id, { name }),
          row(AuditAction.RESOURCE_UPDATE, 'Resource', resourceId, {
            changedFields: ['displayName']
          }),
          row(AuditAction.RESOURCE_RESTORE, 'Resource', resourceId, null)
        ])
      );
    });
  }
);
