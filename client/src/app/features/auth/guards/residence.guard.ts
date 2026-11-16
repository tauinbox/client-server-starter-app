import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import { ensureAuthenticated } from '../utils/ensure-authenticated';
import { afterResidenceUrl } from '../utils/residence-redirect';

/**
 * The residence page is for a signed-in account with no declared country. An
 * account that has one goes on to the page it asked for.
 */
export const residenceGuard: CanActivateFn = (route, state) => {
  const authStore = inject(AuthStore);
  const authService = inject(AuthService);
  const router = inject(Router);
  const origin = inject(DOCUMENT).defaultView?.location.origin;

  return ensureAuthenticated(
    { authStore, authService, router },
    state.url,
    () =>
      authStore.mustDeclareResidence() ||
      router.parseUrl(
        afterResidenceUrl(route.queryParamMap.get('returnUrl'), origin)
      )
  );
};
