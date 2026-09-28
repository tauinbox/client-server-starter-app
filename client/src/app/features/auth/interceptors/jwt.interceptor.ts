import { DOCUMENT, inject } from '@angular/core';
import type {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthStore } from '../store/auth.store';
import { TokenService } from '../services/token.service';
import {
  AUTH_EXCLUDED_URLS,
  matchesAnyPath,
  TOKEN_REFRESH_EXCLUDED_URLS
} from '@features/auth/utils/auth-url-lists';
import { isSameOriginUrl } from '@features/auth/utils/is-same-origin-url';

const withBearer = (
  request: HttpRequest<unknown>,
  token: string
): HttpRequest<unknown> =>
  request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

export const jwtInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const tokenService = inject(TokenService);
  const router = inject(Router);
  const authStore = inject(AuthStore);
  const token = authStore.getAccessToken();
  const baseOrigin = inject(DOCUMENT).defaultView?.location.origin ?? '';
  const isCrossOrigin = !isSameOriginUrl(request, baseOrigin);
  const isAuthExcluded = matchesAnyPath(request, AUTH_EXCLUDED_URLS);
  const skipsRefresh =
    isAuthExcluded ||
    isCrossOrigin ||
    matchesAnyPath(request, TOKEN_REFRESH_EXCLUDED_URLS);

  if (token && !isAuthExcluded && !isCrossOrigin) {
    request = withBearer(request, token);
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !skipsRefresh) {
        const handleError = () => {
          tokenService.forceLogout(router.url);
          return throwError(() => error);
        };

        return tokenService.refreshTokens().pipe(
          catchError(handleError),
          switchMap((tokens) => {
            if (!tokens) {
              return handleError();
            }

            return next(withBearer(request, tokens.access_token));
          })
        );
      }

      return throwError(() => error);
    })
  );
};
