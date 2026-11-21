import type { PermissionCheck } from '@features/auth/casl/app-ability';
import { ADMIN_PANEL_CHECKS } from '@features/auth/casl/admin-panel-checks';

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

  return ADMIN_PANEL_CHECKS.some((check) => authStore.hasPermissions(check));
}
