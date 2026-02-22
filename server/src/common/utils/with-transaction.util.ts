import type { DataSource, EntityManager } from 'typeorm';

/**
 * Runs `operation` inside a single database transaction.
 *
 * TypeORM auto-commits on success and auto-rollbacks on any thrown error.
 * Use the `manager` argument inside the callback to get transactional
 * repositories: `manager.save(Entity, data)`, `manager.update(...)`, etc.
 *
 * @example
 * await withTransaction(dataSource, async (manager) => {
 *   await manager.save(User, newUser);
 *   await manager.delete(RefreshToken, { userId: newUser.id });
 * });
 */
export async function withTransaction<T>(
  dataSource: DataSource,
  operation: (manager: EntityManager) => Promise<T>
): Promise<T> {
  return dataSource.transaction(operation);
}
