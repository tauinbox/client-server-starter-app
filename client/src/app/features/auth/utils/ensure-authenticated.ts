import { catchError, Observable, of, switchMap } from 'rxjs';
import type { Router } from '@angular/router';
import { navigateToLogin } from './navigate-to-login';

type AuthStoreLike = {
  isAuthenticated: () => boolean;
  isAccessTokenExpired: () => boolean;
  clearSession: () => void;
};

type AuthServiceLike = {
  refreshTokens: () => Observable<unknown>;
};

export function ensureAuthenticated(
  authStore: AuthStoreLike,
  authService: AuthServiceLike,
  router: Router,
  returnUrl: string,
  onAuthenticated: () => boolean | Observable<boolean>
): boolean | Observable<boolean> {
  if (authStore.isAuthenticated() && !authStore.isAccessTokenExpired()) {
    return onAuthenticated();
  }

  return authService.refreshTokens().pipe(
    switchMap((tokens) => {
      if (tokens) {
        const result = onAuthenticated();
        return result instanceof Observable ? result : of(result);
      }

      authStore.clearSession();
      navigateToLogin(router, returnUrl);
      return of(false);
    }),
    catchError(() => {
      authStore.clearSession();
      navigateToLogin(router, returnUrl);
      return of(false);
    })
  );
}
