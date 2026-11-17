/**
 * The uniqueness key of one item of a role permission set. An item that is not
 * an object, or that has no permissionId, gets its own key, so that only a
 * repeated permissionId fails the uniqueness check.
 */
export function permissionIdOf(item: unknown): unknown {
  return typeof item === 'object' && item !== null && 'permissionId' in item
    ? item.permissionId
    : Symbol();
}
