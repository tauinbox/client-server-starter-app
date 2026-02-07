import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated() && authService.isAdmin()) {
    return true;
  }

  if (!authService.isAuthenticated()) {
    void router.navigate([`/${AppRouteSegmentEnum.Login}`], {
      queryParams: { returnUrl: state.url }
    });
  } else {
    void router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
  }

  return false;
};
