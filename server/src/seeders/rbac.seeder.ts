import { Seeder } from '@jorgebodega/typeorm-seeding';
import { DataSource } from 'typeorm';
import { Role } from '../modules/auth/entities/role.entity';
import { Permission } from '../modules/auth/entities/permission.entity';
import { RolePermission } from '../modules/auth/entities/role-permission.entity';
import { Resource } from '../modules/auth/entities/resource.entity';
import { Action } from '../modules/auth/entities/action.entity';

const DEFAULT_RESOURCES: {
  name: string;
  subject: string;
  displayName: string;
  description: string;
  allowedActionNames?: string[];
}[] = [
  {
    name: 'users',
    subject: 'User',
    displayName: 'Users',
    description: 'User accounts management'
  },
  {
    name: 'roles',
    subject: 'Role',
    displayName: 'Roles',
    description: 'Role management',
    allowedActionNames: [
      'create',
      'read',
      'update',
      'delete',
      'search',
      'assign'
    ]
  },
  {
    name: 'permissions',
    subject: 'Permission',
    displayName: 'Permissions',
    description: 'Permission and RBAC metadata management'
  },
  {
    name: 'profile',
    subject: 'Profile',
    displayName: 'Profile',
    description: 'User own profile',
    allowedActionNames: ['read', 'update']
  }
];

const DEFAULT_ACTIONS: {
  name: string;
  displayName: string;
  description: string;
  isDefault?: boolean;
}[] = [
  { name: 'create', displayName: 'Create', description: 'Create a new record' },
  {
    name: 'read',
    displayName: 'Read',
    description: 'Read a single record by ID'
  },
  {
    name: 'update',
    displayName: 'Update',
    description: 'Modify an existing record'
  },
  { name: 'delete', displayName: 'Delete', description: 'Remove a record' },
  {
    name: 'search',
    displayName: 'Search',
    description: 'Query and list records, with optional filters'
  },
  {
    name: 'assign',
    displayName: 'Assign',
    description: 'Assign relationships between records',
    isDefault: false
  }
];

export default class RbacSeeder extends Seeder {
  async run(dataSource: DataSource) {
    const roleRepo = dataSource.getRepository(Role);
    const permissionRepo = dataSource.getRepository(Permission);
    const rolePermissionRepo = dataSource.getRepository(RolePermission);
    const resourceRepo = dataSource.getRepository(Resource);
    const actionRepo = dataSource.getRepository(Action);

    // Create default resources
    const savedResources = await resourceRepo.save(
      DEFAULT_RESOURCES.map((r) =>
        resourceRepo.create({
          ...r,
          isSystem: true,
          lastSyncedAt: new Date()
        })
      )
    );

    // Create default actions
    const savedActions = await actionRepo.save(
      DEFAULT_ACTIONS.map((a) =>
        actionRepo.create({ ...a, isDefault: a.isDefault ?? true })
      )
    );

    // Create system roles
    const adminRole = roleRepo.create({
      name: 'admin',
      description: 'System administrator with full access',
      isSystem: true,
      isSuper: true
    });
    const userRole = roleRepo.create({
      name: 'user',
      description: 'Regular user with basic access',
      isSystem: true,
      isSuper: false
    });
    await roleRepo.save([adminRole, userRole]);

    // Create all permissions (full resource × action matrix)
    const permissionEntries = savedResources.flatMap((resource) =>
      savedActions.map((action) =>
        permissionRepo.create({
          resourceId: resource.id,
          actionId: action.id
        })
      )
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

    // User gets profile:read, profile:update, and update:User (own record only)
    const profileResource = savedResources.find((r) => r.name === 'profile');
    const usersResource = savedResources.find((r) => r.name === 'users');
    const readAction = savedActions.find((a) => a.name === 'read');
    const updateAction = savedActions.find((a) => a.name === 'update');
    const profilePermissions = savedPermissions.filter(
      (p) =>
        p.resourceId === profileResource?.id &&
        (p.actionId === readAction?.id || p.actionId === updateAction?.id)
    );
    const userRolePermissions = profilePermissions.map((perm) =>
      rolePermissionRepo.create({
        roleId: userRole.id,
        permissionId: perm.id
      })
    );

    // update:User with ownership condition so regular users can only update their own record
    const updateUserPermission = savedPermissions.find(
      (p) =>
        p.resourceId === usersResource?.id && p.actionId === updateAction?.id
    );
    if (updateUserPermission) {
      userRolePermissions.push(
        rolePermissionRepo.create({
          roleId: userRole.id,
          permissionId: updateUserPermission.id,
          conditions: { ownership: { userField: 'id' } }
        })
      );
    }

    await rolePermissionRepo.save(userRolePermissions);
  }
}
