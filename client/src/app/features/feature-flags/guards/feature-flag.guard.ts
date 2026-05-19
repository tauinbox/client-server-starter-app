import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { AuthService } from '../../auth/services/auth.service';
import { AuthStore } from '../../auth/store/auth.store';
import { ensureAuthenticated } from '../../auth/utils/ensure-authenticated';
import { FeatureFlagsStore } from '../store/feature-flags.store';

/**
 * Route guard: activates only when the named feature flag evaluates `true`
 * for the current caller. Mirrors `permissionGuard()` — requires an
 * authenticated session first (refresh-tokens-then-retry path), then
 * checks the flag. Redirects to `redirectTo` (default `/forbidden`) on miss
 * to match the existing UX of permission denials.
 *
 * Server-side `FeatureFlagGuard` is the authoritative gate (returns 404 for
 * anti-enumeration). This client-side guard is a UX optimization that hides
 * route entries from clients whose flag set says the feature is off.
 */
export function featureFlagGuard(
  key: string,
  redirectTo = `/${AppRouteSegmentEnum.Forbidden}`
): CanActivateFn {
  return (_route, state) => {
    const authStore = inject(AuthStore);
    const authService = inject(AuthService);
    const flagsStore = inject(FeatureFlagsStore);
    const router = inject(Router);

    return ensureAuthenticated(
      authStore,
      authService,
      router,
      state.url,
      () => {
        if (flagsStore.isEnabled(key)()) return true;
        void router.navigate([redirectTo]);
        return false;
      }
    );
  };
}
