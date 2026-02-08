import { inject, Injector } from '@angular/core';
import type {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { TokenService } from '../services/token.service';
import { AuthService } from '../services/auth.service';
import { AuthApiEnum } from '../constants/auth-api.const';

const AUTH_EXCLUDED_URLS = [
  AuthApiEnum.RefreshToken,
  AuthApiEnum.Login,
  AuthApiEnum.Register
] as const;

export const jwtInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const injector = inject(Injector);
  const router = inject(Router);
  const tokenService = inject(TokenService);
  const token = tokenService.getAccessToken();
  const isExcluded = isAuthExcludedUrl(request);

  if (token && !isExcluded) {
    request = addTokenToRequest(request, token);
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      // to avoid circular dependency HttpClient → Interceptor → AuthService → HttpClient
      const authService = injector.get(AuthService);

      if (shouldAttemptTokenRefresh(error, isExcluded)) {
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

function isAuthExcludedUrl(request: HttpRequest<unknown>): boolean {
  return AUTH_EXCLUDED_URLS.some((excludedUrl) =>
    request.url.includes(excludedUrl)
  );
}

function shouldAttemptTokenRefresh(
  error: HttpErrorResponse,
  isExcluded: boolean
): boolean {
  return error.status === 401 && !isExcluded;
}

function addTokenToRequest(
  request: HttpRequest<unknown>,
  token: string
): HttpRequest<unknown> {
  return request.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`
    }
  });
}
