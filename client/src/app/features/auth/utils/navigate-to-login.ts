import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import type { Params, Router, UrlTree } from '@angular/router';

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
