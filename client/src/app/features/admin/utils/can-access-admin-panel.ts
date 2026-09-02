import type { PermissionCheck } from '@features/auth/casl/app-ability';

type AuthStoreLike = {
  hasPermissions: (check: PermissionCheck | PermissionCheck[]) => boolean;
  mustEnrolMfa: () => boolean;
};

export function canAccessAdminPanel(authStore: AuthStoreLike): boolean {
  // The server refuses every authorized route to an account that owes its
  // second factor, so the entry point is hidden rather than left to fail.
  if (authStore.mustEnrolMfa()) {
    return false;
  }

  return (
    authStore.hasPermissions({ action: 'search', subject: 'User' }) ||
    authStore.hasPermissions({ action: 'read', subject: 'Role' }) ||
    authStore.hasPermissions({ action: 'read', subject: 'Permission' }) ||
    authStore.hasPermissions({ action: 'manage', subject: 'FeatureFlag' }) ||
    authStore.hasPermissions({ action: 'manage', subject: 'Billing' })
  );
}
