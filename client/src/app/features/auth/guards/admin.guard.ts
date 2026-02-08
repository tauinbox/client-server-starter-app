import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { TokenService } from '../services/token.service';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { navigateToLogin } from '@features/auth/utils/navigate-to-login';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const tokenService = inject(TokenService);
  const router = inject(Router);

  if (authService.isAuthenticated() && !tokenService.isAccessTokenExpired()) {
    return checkAdmin(authService, router);
  }

  return authService.refreshTokens().pipe(
    map((tokens) => {
      if (tokens) {
        return checkAdmin(authService, router);
      }

      navigateToLogin(router, state.url);
      return false;
    }),
    catchError(() => {
      navigateToLogin(router, state.url);
      return of(false);
    })
  );
};

function checkAdmin(authService: AuthService, router: Router): boolean {
  if (authService.isAdmin()) {
    return true;
  }

  void router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
  return false;
}
