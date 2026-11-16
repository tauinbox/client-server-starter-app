import type { Router, UrlTree } from '@angular/router';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { safeReturnUrl } from './safe-return-url';

const RESIDENCE_PATH = `/${AppRouteSegmentEnum.Residence}`;

const isResidenceUrl = (url: string): boolean =>
  url.split(/[?#]/, 1)[0] === RESIDENCE_PATH;

type AuthStoreLike = {
  mustDeclareResidence: () => boolean;
};

/**
 * An account with no declared country of residence goes to the residence page
 * before any other page, because the country decides whether this deployment
 * may keep its data.
 *
 * Returns null while nothing is owed, and for the residence page itself.
 */
export function residenceRedirect(
  authStore: AuthStoreLike,
  router: Router,
  returnUrl: string
): UrlTree | null {
  if (!authStore.mustDeclareResidence() || isResidenceUrl(returnUrl)) {
    return null;
  }

  return router.createUrlTree([RESIDENCE_PATH], {
    queryParams: { returnUrl }
  });
}

/**
 * The page after the declaration: a same-origin `returnUrl`, never the
 * residence page again, else the root.
 */
export function afterResidenceUrl(
  returnUrl: unknown,
  baseOrigin: string | null | undefined
): string {
  const url = safeReturnUrl(returnUrl, baseOrigin);

  return url && !isResidenceUrl(url) ? url : '/';
}
