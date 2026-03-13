import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthService } from '@features/auth/services/auth.service';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { ensureAuthenticated } from '@features/auth/utils/ensure-authenticated';

export const adminPanelGuard: CanActivateFn = (route, state) => {
  const authStore = inject(AuthStore);
  const authService = inject(AuthService);
  const router = inject(Router);

  return ensureAuthenticated(authStore, authService, router, state.url, () => {
    const hasAccess =
      authStore.hasPermissions({ action: 'search', subject: 'User' }) ||
      authStore.hasPermissions({ action: 'read', subject: 'Role' }) ||
      authStore.hasPermissions({ action: 'read', subject: 'Permission' });

    if (hasAccess) return true;
    void router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
    return false;
  });
};
