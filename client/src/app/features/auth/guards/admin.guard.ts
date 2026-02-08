import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { ensureAuthenticated } from '../utils/ensure-authenticated';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return ensureAuthenticated(authService, router, state.url, () => {
    if (authService.isAdmin()) {
      return true;
    }

    void router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
    return false;
  });
};
