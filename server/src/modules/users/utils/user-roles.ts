import { In } from 'typeorm';
import type {
  EntityManager,
  FindOneOptions,
  FindOptionsRelations
} from 'typeorm';
import type { SourceManagers } from '../../../data-sources';
import { Role } from '../../auth/entities/role.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';

/**
 * Sets `roles` on each user in two reads: the membership rows on the regional
 * manager, then the roles on the settings manager. No query joins the two,
 * because the roles are settings and the memberships are personal data. The
 * roles of one user are sorted by name in code-unit order, as the mock server
 * sorts them; an SQL order would follow the collation of the database.
 */
export async function attachRoles(
  { regional, settings }: SourceManagers,
  users: User[],
  roleRelations?: FindOptionsRelations<Role>
): Promise<void> {
  if (users.length === 0) return;

  const links = await regional.find(UserRole, {
    where: { userId: In(users.map(({ id }) => id)) }
  });
  const roleIds = [...new Set(links.map(({ roleId }) => roleId))];
  const found =
    roleIds.length === 0
      ? []
      : await settings.find(Role, {
          where: { id: In(roleIds) },
          relations: roleRelations
        });
  // Role names are unique, so no two compare equal.
  const roles = found.toSorted((a, b) => (a.name < b.name ? -1 : 1));

  for (const user of users) {
    const held = new Set(
      links
        .filter(({ userId }) => userId === user.id)
        .map(({ roleId }) => roleId)
    );

    user.roles = roles.filter(({ id }) => held.has(id));
  }
}

/** `managers.regional.findOne(User, options)` with `roles` set. */
export async function findUserWithRoles(
  managers: SourceManagers,
  options: FindOneOptions<User>
): Promise<User | null> {
  const user = await managers.regional.findOne(User, options);

  if (user) await attachRoles(managers, [user]);

  return user;
}

/** `findUserWithRoles` that throws when no row matches, as `findOneOrFail`. */
export async function findUserWithRolesOrFail(
  managers: SourceManagers,
  options: FindOneOptions<User>
): Promise<User> {
  const user = await managers.regional.findOneOrFail(User, options);

  await attachRoles(managers, [user]);

  return user;
}

/** Adds one membership row; a role the user already holds is a unique violation. */
export async function addUserRole(
  manager: EntityManager,
  { userId, roleId }: { userId: string; roleId: string }
): Promise<void> {
  await manager.insert(UserRole, { userId, roleId });
}
