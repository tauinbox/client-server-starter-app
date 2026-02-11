import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { ensureAuthenticated } from '../utils/ensure-authenticated';

export const adminGuard: CanActivateFn = (route, state) => {
  const authStore = inject(AuthStore);
  const authService = inject(AuthService);
  const router = inject(Router);

  return ensureAuthenticated(authStore, authService, router, state.url, () => {
    if (authStore.isAdmin()) {
      return true;
    }

    void router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
    return false;
  });
};
