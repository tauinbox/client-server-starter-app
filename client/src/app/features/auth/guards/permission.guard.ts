import { inject } from '@angular/core';
import type { ActivatedRouteSnapshot, CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { ensureAuthenticated } from '../utils/ensure-authenticated';
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
        if (authStore.hasPermissions({ action, subject })) return true;
        void router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
        return false;
      }
    );
  };
}

export function instancePermissionGuard(
  action: PermissionCheck['action'],
  subject: PermissionCheck['subject'],
  instanceFactory: (route: ActivatedRouteSnapshot) => Record<string, unknown>
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
        const instance = instanceFactory(route);
        if (authStore.hasPermissions({ action, subject, instance }))
          return true;
        void router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
        return false;
      }
    );
  };
}
