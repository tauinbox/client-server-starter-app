import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import type { Router } from '@angular/router';

export const navigateToLogin = (
  router: Pick<Router, 'navigate'>,
  returnUrl: string
): void => {
  void router.navigate([`/${AppRouteSegmentEnum.Login}`], {
    queryParams: { returnUrl }
  });
};
