/**
 * Emitted after a committed write that changes the grantable actions of a
 * resource (a narrowing, a widening, or the restore of an orphaned resource).
 * Any role can hold a grant on the resource, so the abilities of any user can
 * change, and the event carries no user IDs.
 *
 * Like {@link RolePermissionsChangedEvent}, it must not revoke tokens:
 * abilities are re-derived from the database on each request.
 */
export class ResourceActionsChangedEvent {}
