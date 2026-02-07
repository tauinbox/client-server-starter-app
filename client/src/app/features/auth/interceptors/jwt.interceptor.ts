import { inject, Injector } from '@angular/core';
import type {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';
import { TokenService } from '../services/token.service';
import { AuthService } from '../services/auth.service';

const AUTH_EXCLUDED_URLS = ['refresh-token', 'login', 'register'] as const;

export const jwtInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const injector = inject(Injector);
  const tokenService = inject(TokenService);
  const token = tokenService.getAccessToken();

  if (token) {
    request = addTokenToRequest(request, token);
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      // to avoid circular dependency HttpClient → Interceptor → AuthService → HttpClient
      const authService = injector.get(AuthService);

      if (shouldAttemptTokenRefresh(error, request)) {
        return authService.refreshTokens().pipe(
          switchMap((tokens) => {
            if (!tokens) {
              authService.logout();
              return throwError(() => error);
            }

            return next(addTokenToRequest(request, tokens.access_token));
          }),
          catchError(() => {
            authService.logout();
            return throwError(() => error);
          })
        );
      }

      return throwError(() => error);
    })
  );
};

function shouldAttemptTokenRefresh(
  error: HttpErrorResponse,
  request: HttpRequest<unknown>
): boolean {
  return (
    error.status === 401 &&
    !AUTH_EXCLUDED_URLS.some((url) => request.url.includes(url))
  );
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
