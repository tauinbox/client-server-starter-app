import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { ensureAuthenticated } from '../utils/ensure-authenticated';
import { mfaEnrolmentRedirect } from '../utils/mfa-enrolment-redirect';
import type { PermissionCheck } from '../casl/app-ability';

export function permissionGuard(
  action: PermissionCheck['action'],
  subject: PermissionCheck['subject']
): CanActivateFn {
  return (route, state) => {
    const authStore = inject(AuthStore);
    const authService = inject(AuthService);
    const router = inject(Router);

    return ensureAuthenticated(
      authStore,
      authService,
      router,
      state.url,
      () => {
        const enrolment = mfaEnrolmentRedirect(authStore, router);
        if (enrolment) return enrolment;
        if (authStore.hasPermissions({ action, subject })) return true;
        return router.createUrlTree([`/${AppRouteSegmentEnum.Forbidden}`]);
      }
    );
  };
}
