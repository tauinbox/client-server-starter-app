/**
 * Emitted when a role's effective permission set changes (permissions added,
 * removed, replaced, or the role deleted) — carries the IDs of every user who
 * currently holds the role so connected clients can refresh their abilities.
 *
 * Deliberately distinct from {@link UserRoleChangedEvent}: that event also
 * revokes the user's tokens (force-logout), which is appropriate when a user's
 * role membership changes but not when a role they keep merely changes its
 * permissions — abilities are re-evaluated from the DB per request, so no
 * re-login is needed and fanning a logout to every holder of the universal
 * `user` role would be catastrophic.
 */
export class RolePermissionsChangedEvent {
  constructor(public readonly userIds: string[]) {}
}
