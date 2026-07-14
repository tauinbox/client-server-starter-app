import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { BILLING_FLAG_KEY } from '@app/shared/constants';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';

/**
 * Route guard for the billing feature. Unlike `featureFlagGuard`
 * it does NOT require authentication — the pricing page is public — it only
 * checks that the public `billing` flag resolves true (server gates it on at
 * least one provider being configured). Flags are normally loaded during app
 * bootstrap; for an anonymous deep-link the load is best-effort, so this guard
 * awaits it before deciding. Redirects home on miss.
 */
export const billingAvailableGuard: CanActivateFn = async () => {
  const flagsStore = inject(FeatureFlagsStore);
  const router = inject(Router);

  // load() resolves immediately when flags are already loaded and joins an
  // in-flight fetch otherwise, so no duplicate request is issued.
  await flagsStore.load();

  if (flagsStore.isEnabled(BILLING_FLAG_KEY)()) {
    return true;
  }

  return router.createUrlTree(['/']);
};
