import type {
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
  ObjectLiteral,
  QueryDeepPartialEntity
} from 'typeorm';

/**
 * Writes the given columns to the row that `where` selects, and tells whether
 * a row matched. `save` writes back every column of a loaded copy, so it
 * undoes a concurrent write, and it inserts the row again after a delete.
 * Columns set to `undefined` are not written; with none left, only the match
 * is checked.
 */
export async function keyedUpdate<T extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<T>,
  where: FindOptionsWhere<T>,
  changes: QueryDeepPartialEntity<T>
): Promise<boolean> {
  const set = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined)
  ) as QueryDeepPartialEntity<T>;
  if (Object.keys(set).length === 0) {
    return manager.exists(target, { where });
  }
  const { affected } = await manager.update(target, where, set);
  return affected !== 0;
}
