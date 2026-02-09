import { catchError, Observable, of, switchMap } from 'rxjs';
import type { Router } from '@angular/router';
import type { AuthService } from '../services/auth.service';
import { navigateToLogin } from './navigate-to-login';

export function ensureAuthenticated(
  authService: AuthService,
  router: Router,
  returnUrl: string,
  onAuthenticated: () => boolean | Observable<boolean>
): boolean | Observable<boolean> {
  if (authService.isAuthenticated() && !authService.isAccessTokenExpired()) {
    return onAuthenticated();
  }

  return authService.refreshTokens().pipe(
    switchMap((tokens) => {
      if (tokens) {
        const result = onAuthenticated();
        return result instanceof Observable ? result : of(result);
      }

      authService.clearSession();
      navigateToLogin(router, returnUrl);
      return of(false);
    }),
    catchError(() => {
      authService.clearSession();
      navigateToLogin(router, returnUrl);
      return of(false);
    })
  );
}
