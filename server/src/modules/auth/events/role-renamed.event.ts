import type { EntityManager } from 'typeorm';

/**
 * Emitted inside the transaction that renames a role. Feature-flag role rules
 * store role names, not IDs, so a listener rewrites them through `manager`; a
 * listener error rolls the rename back. `committed` resolves after the commit,
 * for work that must not see uncommitted rows, such as a cache reset.
 */
export class RoleRenamedEvent {
  constructor(
    public readonly oldName: string,
    public readonly newName: string,
    public readonly manager: EntityManager,
    public readonly committed: Promise<void>
  ) {}
}
