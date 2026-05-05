import type { PermissionCheck } from '@features/auth/casl/app-ability';

type AuthStoreLike = {
  hasPermissions: (check: PermissionCheck | PermissionCheck[]) => boolean;
};

export function canAccessAdminPanel(authStore: AuthStoreLike): boolean {
  return (
    authStore.hasPermissions({ action: 'search', subject: 'User' }) ||
    authStore.hasPermissions({ action: 'read', subject: 'Role' }) ||
    authStore.hasPermissions({ action: 'read', subject: 'Permission' })
  );
}
