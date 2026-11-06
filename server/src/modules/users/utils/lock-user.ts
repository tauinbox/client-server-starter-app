import type { EntityManager } from 'typeorm';
import { User } from '../entities/user.entity';

/**
 * Reads the user row FOR UPDATE in the transaction of `manager`, then its
 * roles. Every write of the row or of its role membership takes the same lock
 * first, so an instance check on the returned record judges the row that the
 * write changes. Returns null when no row matches.
 */
export async function lockUserWithRoles(
  manager: EntityManager,
  { id, withDeleted = false }: { id: string; withDeleted?: boolean }
): Promise<User | null> {
  const locked = await manager.findOne(User, {
    where: { id },
    withDeleted,
    lock: { mode: 'pessimistic_write' }
  });

  if (!locked) return null;

  return manager.findOne(User, {
    where: { id },
    relations: { roles: true },
    withDeleted
  });
}
