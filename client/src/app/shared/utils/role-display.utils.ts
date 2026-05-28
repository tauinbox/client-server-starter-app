import { SYSTEM_ROLES } from '@app/shared/constants';

/**
 * Minimal role shape needed to render a role chip. Both `RoleResponse` (auth
 * profile) and `RoleAdminResponse` (admin user views) satisfy it, so the same
 * display helpers work across every place that lists a user's roles.
 */
type RoleLike = { id: string; name: string };

const ROLE_ICONS: Readonly<Record<string, string>> = {
  [SYSTEM_ROLES.ADMIN]: 'admin_panel_settings',
  [SYSTEM_ROLES.USER]: 'person'
};

const FALLBACK_ROLE_ICON = 'badge';

/** Material Icons ligature used as the chip avatar for a given role name. */
export function roleIcon(roleName: string): string {
  return ROLE_ICONS[roleName] ?? FALLBACK_ROLE_ICON;
}

export function isAdminRole(role: RoleLike): boolean {
  return role.name === SYSTEM_ROLES.ADMIN;
}

/** Admin role first (it carries the most UI weight); the rest keep their original order. */
export function sortRolesForDisplay<T extends RoleLike>(
  roles: readonly T[]
): T[] {
  return [...roles].sort(
    (a, b) => Number(!isAdminRole(a)) - Number(!isAdminRole(b))
  );
}

/** Comma-joined names of the roles hidden behind the table's "+N" overflow chip. */
export function overflowRoleNames(sortedRoles: readonly RoleLike[]): string {
  return sortedRoles
    .slice(1)
    .map((r) => r.name)
    .join(', ');
}
