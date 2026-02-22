import { Seeder } from '@jorgebodega/typeorm-seeding';
import { DataSource } from 'typeorm';
import { Role } from '../modules/auth/entities/role.entity';
import { Permission } from '../modules/auth/entities/permission.entity';
import { RolePermission } from '../modules/auth/entities/role-permission.entity';
const PERMISSION_LIST: { resource: string; action: string }[] = [
  { resource: 'users', action: 'create' },
  { resource: 'users', action: 'read' },
  { resource: 'users', action: 'update' },
  { resource: 'users', action: 'delete' },
  { resource: 'users', action: 'list' },
  { resource: 'users', action: 'search' },
  { resource: 'profile', action: 'read' },
  { resource: 'profile', action: 'update' },
  { resource: 'roles', action: 'create' },
  { resource: 'roles', action: 'read' },
  { resource: 'roles', action: 'update' },
  { resource: 'roles', action: 'delete' },
  { resource: 'roles', action: 'assign' }
];

export default class RbacSeeder extends Seeder {
  async run(dataSource: DataSource) {
    const roleRepo = dataSource.getRepository(Role);
    const permissionRepo = dataSource.getRepository(Permission);
    const rolePermissionRepo = dataSource.getRepository(RolePermission);

    // Create system roles
    const adminRole = roleRepo.create({
      name: 'admin',
      description: 'System administrator with full access',
      isSystem: true
    });
    const userRole = roleRepo.create({
      name: 'user',
      description: 'Regular user with basic access',
      isSystem: true
    });
    await roleRepo.save([adminRole, userRole]);

    // Create all permissions
    const permissionEntries = PERMISSION_LIST.map(({ resource, action }) =>
      permissionRepo.create({ resource, action })
    );
    const savedPermissions = await permissionRepo.save(permissionEntries);

    // Admin gets all permissions
    const adminRolePermissions = savedPermissions.map((perm) =>
      rolePermissionRepo.create({
        roleId: adminRole.id,
        permissionId: perm.id
      })
    );
    await rolePermissionRepo.save(adminRolePermissions);

    // User gets profile permissions only
    const profilePermissions = savedPermissions.filter(
      (p) => p.resource === 'profile'
    );
    const userRolePermissions = profilePermissions.map((perm) =>
      rolePermissionRepo.create({
        roleId: userRole.id,
        permissionId: perm.id
      })
    );
    await rolePermissionRepo.save(userRolePermissions);
  }
}
