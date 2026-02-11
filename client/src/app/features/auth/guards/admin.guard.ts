import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { ensureAuthenticated } from '../utils/ensure-authenticated';

export const adminGuard: CanActivateFn = (route, state) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  return ensureAuthenticated(authStore, router, state.url, () => {
    if (authStore.isAdmin()) {
      return true;
    }

    void router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
    return false;
  });
};
