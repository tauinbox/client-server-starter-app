import { inject, Injector } from '@angular/core';
import type {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import { isAuthExcludedUrl } from '@features/auth/utils/is-auth-excluded-urls';
import { isTokenRefreshExcludedUrl } from '@features/auth/utils/is-token-refresh-excluded-urls';
import { shouldAttemptTokenRefresh } from '@features/auth/utils/should-attempt-token-refresh';
import { addTokenToRequest } from '@features/auth/utils/add-token-to-request';

export const jwtInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const injector = inject(Injector);
  const router = inject(Router);
  const authStore = inject(AuthStore);
  const token = authStore.getAccessToken();
  const isAuthExcluded = isAuthExcludedUrl(request);
  const isTokenRefreshExcluded = isTokenRefreshExcludedUrl(request);

  if (token && !isAuthExcluded) {
    request = addTokenToRequest(request, token);
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (
        shouldAttemptTokenRefresh(
          error,
          isAuthExcluded || isTokenRefreshExcluded
        )
      ) {
        // Lazy-inject AuthService to avoid circular dependency:
        // HttpClient → Interceptor → AuthService → HttpClient
        const authService = injector.get(AuthService);

        const handleError = () => {
          authService.logout(router.url);
          return throwError(() => error);
        };

        return authService.refreshTokens().pipe(
          catchError(handleError),
          switchMap((tokens) => {
            if (!tokens) {
              return handleError();
            }

            return next(addTokenToRequest(request, tokens.access_token));
          })
        );
      }

      return throwError(() => error);
    })
  );
};
