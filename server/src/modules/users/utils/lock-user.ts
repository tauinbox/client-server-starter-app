import type { SourceManagers } from '../../../data-sources';
import { User } from '../entities/user.entity';
import { findUserWithRoles } from './user-roles';

/**
 * Reads the user row FOR UPDATE in the transaction of `managers.regional`,
 * then its roles. Every write of the row or of its role membership takes the
 * same lock first, so an instance check on the returned record judges the row
 * that the write changes. Returns null when no row matches.
 */
export async function lockUserWithRoles(
  managers: SourceManagers,
  { id, withDeleted = false }: { id: string; withDeleted?: boolean }
): Promise<User | null> {
  const locked = await managers.regional.findOne(User, {
    where: { id },
    withDeleted,
    lock: { mode: 'pessimistic_write' }
  });

  if (!locked) return null;

  return findUserWithRoles(managers, { where: { id }, withDeleted });
}
