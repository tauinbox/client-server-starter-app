import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import type { Location } from '@angular/common';
import type { Params, Router, UrlTree } from '@angular/router';

// Until the first navigation of a page load ends, `router.url` is still `/`.
// The session restore runs before that navigation starts, so the address bar
// is the only record of the page the user asked for.
export const currentReturnUrl = (router: Router, location: Location): string =>
  router.navigated ? router.url : location.path(true);

const loginCommands = [`/${AppRouteSegmentEnum.Login}`];
const loginExtras = (returnUrl: string, extraParams: Params = {}) => ({
  queryParams: { returnUrl, ...extraParams }
});

// Guards redirect by returning this tree; services, which run outside a
// navigation, keep the imperative form below.
export const loginUrlTree = (router: Router, returnUrl: string): UrlTree =>
  router.createUrlTree(loginCommands, loginExtras(returnUrl));

export const navigateToLogin = (
  router: Router,
  returnUrl: string,
  extraParams?: Params
): void => {
  void router.navigate(loginCommands, loginExtras(returnUrl, extraParams));
};
