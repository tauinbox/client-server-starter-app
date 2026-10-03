import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { RoleDeletedEvent } from '../src/modules/auth/events/role-deleted.event';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { User } from '../src/modules/users/entities/user.entity';

// A request of a holder can land while the role is being removed. It must not
// put the grants of the deleted role back into the permission cache.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Role delete and the permission cache (e2e)', () => {
  const tag = `role-delete-cache-${Date.now()}`;
  const email = `${tag}@example.com`;

  let app: INestApplication;
  let dataSource: DataSource;
  let roleService: RoleService;
  let permissionService: PermissionService;
  let holder: User;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    roleService = app.get(RoleService);
    permissionService = app.get(PermissionService);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const userRepository = dataSource.getRepository(User);
    holder = await userRepository.save(
      userRepository.create({
        email,
        firstName: 'Role',
        lastName: 'Holder',
        isEmailVerified: true,
        password: null
      })
    );
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (dataSource) {
      await dataSource.getRepository(User).delete({ email });
    }
    await app?.close();
  });

  it('drops the grants of a role deleted while a holder reads them', async () => {
    const permissions = await dataSource.getRepository(Permission).find();
    const deleteRole = permissions.find(
      (p) => p.action.name === 'delete' && p.resource.subject === 'Role'
    );
    if (!deleteRole) throw new Error('Permission delete:Role missing');

    const role = await roleService.create({ name: `${tag}-role` });
    await roleService.setPermissionsForRole(role.id, [
      { permissionId: deleteRole.id }
    ]);
    await roleService.assignRoleToUser(holder.id, role.id);

    // Stand-in for a request of the holder that lands after the remove and
    // before its commit: it loads from the DB and fills the cache. The event
    // runs inside the transaction of the remove.
    const eventEmitter = app.get(EventEmitter2);
    const emitAsync = eventEmitter.emitAsync.bind(eventEmitter);
    let readInside = false;
    jest
      .spyOn(eventEmitter, 'emitAsync')
      .mockImplementation(async (event, ...values: unknown[]) => {
        if (event === RoleDeletedEvent.name) {
          await permissionService.getPermissionsForUser(holder.id);
          await permissionService.getRolesForUser(holder.id);
          readInside = true;
        }
        return emitAsync(event, ...values);
      });

    await roleService.delete(role.id);

    expect(readInside).toBe(true);
    const roleRepository = dataSource.getRepository(Role);
    expect(await roleRepository.findOne({ where: { id: role.id } })).toBeNull();
    const cachedPermissions = await permissionService.getPermissionsForUser(
      holder.id
    );
    expect(cachedPermissions.map((p) => p.permission)).not.toContain(
      `${deleteRole.resource.name}:${deleteRole.action.name}`
    );
    const cachedRoles = await permissionService.getRolesForUser(holder.id);
    expect(cachedRoles.map((r) => r.name)).not.toContain(`${tag}-role`);
  });
});
