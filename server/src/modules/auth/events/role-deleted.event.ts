/**
 * Emitted after a role is deleted. Feature-flag role rules store role names,
 * so the listener removes the name: a later role with the same name must not
 * inherit the targeting.
 */
export class RoleDeletedEvent {
  constructor(public readonly name: string) {}
}
