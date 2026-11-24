import type { EntityManager } from 'typeorm';

/**
 * Emitted inside the transaction that renames a role. Feature-flag role rules
 * store role names, not IDs, so a listener rewrites them through `manager`; a
 * listener error rolls the rename back. The caches and the SSE pushes follow
 * from the settings change log, after the commit.
 */
export class RoleRenamedEvent {
  constructor(
    public readonly oldName: string,
    public readonly newName: string,
    public readonly manager: EntityManager
  ) {}
}
