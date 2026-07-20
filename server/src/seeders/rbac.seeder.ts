import { Seeder } from '@jorgebodega/typeorm-seeding';
import { DataSource, DeepPartial, ObjectLiteral, Repository } from 'typeorm';
import type { PermissionCondition } from '@app/shared/types';
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

const DEFAULT_ROLES = [
  {
    name: 'admin',
    description: 'System administrator with full access',
    isSystem: true,
    isSuper: true
  },
  {
    name: 'user',
    description: 'Regular user with basic access',
    isSystem: true,
    isSuper: false
  }
];

type NamedRow = ObjectLiteral & { name: string };

/**
 * Inserts only the seeds whose `name` is not already stored and returns the
 * rows for every seed — pre-existing ones untouched, so an admin's edits to a
 * seeded row survive a re-run.
 */
async function ensureRows<T extends NamedRow>(
  repo: Repository<T>,
  seeds: (DeepPartial<T> & { name: string })[]
): Promise<T[]> {
  const stored = new Map((await repo.find()).map((row) => [row.name, row]));
  const missing = seeds.filter((seed) => !stored.has(seed.name));
  const created = missing.length
    ? await repo.save(missing.map((seed) => repo.create(seed)))
    : [];

  return [
    ...seeds
      .map((seed) => stored.get(seed.name))
      .filter((row) => row !== undefined),
    ...created
  ];
}

const permissionKey = (resourceId: string, actionId: string) =>
  `${resourceId}:${actionId}`;

const rolePermissionKey = (roleId: string, permissionId: string) =>
  `${roleId}:${permissionId}`;

type RolePermissionSeed = {
  roleId: string;
  permissionId: string;
  conditions?: PermissionCondition;
};

export default class RbacSeeder extends Seeder {
  // Additive and idempotent at every level (rows, permission matrix,
  // role-permission grants): a re-run inserts only what is missing instead of
  // hitting the unique constraints on resource/action/role name.
  async run(dataSource: DataSource) {
    const roleRepo = dataSource.getRepository(Role);
    const permissionRepo = dataSource.getRepository(Permission);
    const rolePermissionRepo = dataSource.getRepository(RolePermission);
    const resourceRepo = dataSource.getRepository(Resource);
    const actionRepo = dataSource.getRepository(Action);

    const resources = await ensureRows(
      resourceRepo,
      DEFAULT_RESOURCES.map((r) => ({
        ...r,
        isSystem: true,
        lastSyncedAt: new Date()
      }))
    );
    const actions = await ensureRows(
      actionRepo,
      DEFAULT_ACTIONS.map((a) => ({ ...a, isDefault: a.isDefault ?? true }))
    );
    const roles = await ensureRows(roleRepo, DEFAULT_ROLES);

    const adminRole = roles.find((r) => r.name === 'admin');
    const userRole = roles.find((r) => r.name === 'user');
    if (!adminRole || !userRole) {
      throw new Error('RBAC seeder: system roles could not be resolved');
    }

    // Full resource x action matrix.
    const permissionsByKey = new Map(
      (await permissionRepo.find()).map((p) => [
        permissionKey(p.resourceId, p.actionId),
        p
      ])
    );
    const missingPermissions = resources.flatMap((resource) =>
      actions
        .filter(
          (action) =>
            !permissionsByKey.has(permissionKey(resource.id, action.id))
        )
        .map((action) =>
          permissionRepo.create({
            resourceId: resource.id,
            actionId: action.id
          })
        )
    );
    const createdPermissions = missingPermissions.length
      ? await permissionRepo.save(missingPermissions)
      : [];
    for (const permission of createdPermissions) {
      permissionsByKey.set(
        permissionKey(permission.resourceId, permission.actionId),
        permission
      );
    }
    const seededPermissions = resources.flatMap((resource) =>
      actions
        .map((action) =>
          permissionsByKey.get(permissionKey(resource.id, action.id))
        )
        .filter((permission) => permission !== undefined)
    );

    const grants: RolePermissionSeed[] = seededPermissions.map(
      (permission) => ({ roleId: adminRole.id, permissionId: permission.id })
    );

    // User gets profile:read, profile:update, and update:User (own record only)
    const profileResource = resources.find((r) => r.name === 'profile');
    const usersResource = resources.find((r) => r.name === 'users');
    const readAction = actions.find((a) => a.name === 'read');
    const updateAction = actions.find((a) => a.name === 'update');
    for (const permission of seededPermissions) {
      if (
        permission.resourceId === profileResource?.id &&
        (permission.actionId === readAction?.id ||
          permission.actionId === updateAction?.id)
      ) {
        grants.push({ roleId: userRole.id, permissionId: permission.id });
      }
      if (
        permission.resourceId === usersResource?.id &&
        permission.actionId === updateAction?.id
      ) {
        grants.push({
          roleId: userRole.id,
          permissionId: permission.id,
          conditions: { ownership: { userField: 'id' } }
        });
      }
    }

    const storedGrants = new Set(
      (await rolePermissionRepo.find()).map((rp) =>
        rolePermissionKey(rp.roleId, rp.permissionId)
      )
    );
    const missingGrants = grants.filter(
      (grant) =>
        !storedGrants.has(rolePermissionKey(grant.roleId, grant.permissionId))
    );
    if (missingGrants.length === 0) return;

    await rolePermissionRepo.save(
      missingGrants.map((grant) => rolePermissionRepo.create(grant))
    );
  }
}
