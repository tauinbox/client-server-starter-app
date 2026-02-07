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
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';

const AUTH_EXCLUDED_URLS = [
  AppRouteSegmentEnum.RefreshToken,
  AppRouteSegmentEnum.Login,
  AppRouteSegmentEnum.Register
] as const;

export const jwtInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const injector = inject(Injector);
  const router = inject(Router);
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
              authService.logout(router.url);
              return throwError(() => error);
            }

            return next(addTokenToRequest(request, tokens.access_token));
          }),
          catchError(() => {
            authService.logout(router.url);
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
