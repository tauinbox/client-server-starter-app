import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthService } from '@features/auth/services/auth.service';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { ensureAuthenticated } from '@features/auth/utils/ensure-authenticated';
import { mfaEnrolmentRedirect } from '@features/auth/utils/mfa-enrolment-redirect';
import { canAccessAdminPanel } from '../utils/can-access-admin-panel';

export const adminPanelGuard: CanActivateFn = (route, state) => {
  const authStore = inject(AuthStore);
  const authService = inject(AuthService);
  const router = inject(Router);

  return ensureAuthenticated(authStore, authService, router, state.url, () => {
    const enrolment = mfaEnrolmentRedirect(authStore, router);
    if (enrolment) return enrolment;
    if (canAccessAdminPanel(authStore)) return true;
    return router.createUrlTree([`/${AppRouteSegmentEnum.Forbidden}`]);
  });
};
