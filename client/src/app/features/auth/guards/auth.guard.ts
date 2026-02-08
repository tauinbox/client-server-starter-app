import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { TokenService } from '../services/token.service';
import { navigateToLogin } from '@features/auth/utils/navigate-to-login';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const tokenService = inject(TokenService);
  const router = inject(Router);

  if (authService.isAuthenticated() && !tokenService.isAccessTokenExpired()) {
    return true;
  }

  return authService.refreshTokens().pipe(
    map((tokens) => {
      if (tokens) {
        return true;
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
