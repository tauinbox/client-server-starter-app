/**
 * Emitted after a role gets a new name. Feature-flag role rules store role
 * names, not IDs, so the listener rewrites them to keep the targeting.
 */
export class RoleRenamedEvent {
  constructor(
    public readonly oldName: string,
    public readonly newName: string
  ) {}
}
