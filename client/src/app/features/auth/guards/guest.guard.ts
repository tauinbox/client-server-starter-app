import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';

export const guestGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (authStore.isAuthenticated()) {
    void router.navigate([`/${AppRouteSegmentEnum.Profile}`]);
    return false;
  }

  return true;
};
