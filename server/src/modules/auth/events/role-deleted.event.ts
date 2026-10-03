import type { EntityManager } from 'typeorm';

/**
 * Emitted inside the transaction that deletes a role. Feature-flag role rules
 * store role names, so a listener removes the name through `manager`: a later
 * role with the same name must not inherit the targeting. A listener error
 * rolls the delete back. `committed` resolves after the commit.
 */
export class RoleDeletedEvent {
  constructor(
    public readonly name: string,
    public readonly manager: EntityManager,
    public readonly committed: Promise<void>
  ) {}
}
