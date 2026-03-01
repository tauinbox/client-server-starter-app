import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import type { Router } from '@angular/router';

export const navigateToLogin = (router: Router, returnUrl: string): void => {
  void router.navigate([`/${AppRouteSegmentEnum.Login}`], {
    queryParams: { returnUrl }
  });
};
