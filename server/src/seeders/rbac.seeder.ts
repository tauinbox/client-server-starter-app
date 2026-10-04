import { Seeder } from '@jorgebodega/typeorm-seeding';
import { DataSource, DeepPartial, ObjectLiteral, Repository } from 'typeorm';
import type { PermissionCondition } from '@app/shared/types';
import { Role } from '../modules/auth/entities/role.entity';
import { Permission } from '../modules/auth/entities/permission.entity';
import { RolePermission } from '../modules/auth/entities/role-permission.entity';
import { Resource } from '../modules/auth/entities/resource.entity';
import { Action } from '../modules/auth/entities/action.entity';
import {
  RESOURCE_METADATA_KEY,
  type ResourceMetadata
} from '../modules/auth/decorators/register-resource.decorator';
import { UsersController } from '../modules/users/controllers/users.controller';
import { RolesController } from '../modules/auth/controllers/roles.controller';
import { RbacController } from '../modules/auth/controllers/rbac.controller';
import { AuthController } from '../modules/auth/controllers/auth.controller';

// The names, subjects and action lists come from the @RegisterResource of each
// controller, which is the declaration the startup sync reads too. Thus a seed
// before the first start, or on a schema that no migration filled, still
// writes every declared action and permission.
const SEEDED_RESOURCES: object[] = [
  UsersController,
  RolesController,
  RbacController,
  AuthController
];

function declarationOf(controller: object): ResourceMetadata {
  const meta = Reflect.getMetadata(RESOURCE_METADATA_KEY, controller) as
    ResourceMetadata | undefined;
  if (!meta) {
    throw new Error(
      'RBAC seeder: a seeded controller has no @RegisterResource'
    );
  }
  return meta;
}

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

    const declared = SEEDED_RESOURCES.map((controller) => ({
      meta: declarationOf(controller)
    }));
    const resources = await ensureRows(
      resourceRepo,
      declared.map(({ meta }) => ({
        name: meta.name,
        subject: meta.subject,
        displayName: meta.displayName,
        description: meta.description,
        actionNames: [...meta.actions],
        conditionalActionNames: [...meta.conditionalActions],
        isSystem: true,
        lastSyncedAt: new Date()
      }))
    );
    // A stored row keeps its admin edits, but its declared lists follow the
    // code, as the sync rewrites them.
    for (const resource of resources) {
      const meta = declared.find((d) => d.meta.name === resource.name)?.meta;
      if (meta) {
        resource.actionNames = [...meta.actions];
        resource.conditionalActionNames = [...meta.conditionalActions];
      }
    }
    await resourceRepo.save(resources);

    const actions = await ensureRows(
      actionRepo,
      [...new Set(declared.flatMap(({ meta }) => meta.actions))].map(
        (name) => ({ name })
      )
    );
    const roles = await ensureRows(roleRepo, DEFAULT_ROLES);

    const adminRole = roles.find((r) => r.name === 'admin');
    const userRole = roles.find((r) => r.name === 'user');
    if (!adminRole || !userRole) {
      throw new Error('RBAC seeder: system roles could not be resolved');
    }

    // One permission per pair the code checks.
    const permissionsByKey = new Map(
      (await permissionRepo.find()).map((p) => [
        permissionKey(p.resourceId, p.actionId),
        p
      ])
    );
    const declaredActions = (resource: Resource) =>
      actions.filter((action) => resource.actionNames.includes(action.name));
    const missingPermissions = resources.flatMap((resource) =>
      declaredActions(resource)
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
      declaredActions(resource)
        .map((action) =>
          permissionsByKey.get(permissionKey(resource.id, action.id))
        )
        .filter((permission) => permission !== undefined)
    );

    const grants: RolePermissionSeed[] = seededPermissions.map(
      (permission) => ({ roleId: adminRole.id, permissionId: permission.id })
    );

    // User gets profile:update and update:User (own record only)
    const profileResource = resources.find((r) => r.name === 'profile');
    const usersResource = resources.find((r) => r.name === 'users');
    const updateAction = actions.find((a) => a.name === 'update');
    for (const permission of seededPermissions) {
      if (
        permission.resourceId === profileResource?.id &&
        permission.actionId === updateAction?.id
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
