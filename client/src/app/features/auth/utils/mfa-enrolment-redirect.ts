import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import type { Router, UrlTree } from '@angular/router';

type AuthStoreLike = {
  mustEnrolMfa: () => boolean;
};

/**
 * The profile page carries the enrolment card, so an account that owes the
 * second factor is sent there rather than to the denied page: the server
 * refuses the protected routes with the same reason, and a denial the holder
 * can act on is worth more than one they cannot.
 *
 * Returns null while nothing is owed, which lets a guard keep its own answer.
 */
export function mfaEnrolmentRedirect(
  authStore: AuthStoreLike,
  router: Router
): UrlTree | null {
  if (!authStore.mustEnrolMfa()) {
    return null;
  }

  return router.createUrlTree([`/${AppRouteSegmentEnum.Profile}`]);
}
