import { inject } from '@angular/core';
import type {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';
import { TokenService } from '../services/token.service';
import { Router } from '@angular/router';

const AUTH_EXCLUDED_URLS = ['refresh-token', 'login'] as const;

export const jwtInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const tokenService = inject(TokenService);
  const router = inject(Router);
  const token = tokenService.getAccessToken();

  if (token) {
    request = addTokenToRequest(request, token);
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (shouldAttemptTokenRefresh(error, request, tokenService)) {
        return tokenService.refreshToken().pipe(
          switchMap((tokens) => {
            if (!tokens) {
              void router.navigate(['/login']);
              return throwError(() => error);
            }

            return next(addTokenToRequest(request, tokens.access_token));
          }),
          catchError(() => {
            void router.navigate(['/login']);
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
  request: HttpRequest<unknown>,
  tokenService: TokenService
): boolean {
  return (
    error.status === 401 &&
    !AUTH_EXCLUDED_URLS.some((url) => request.url.includes(url)) &&
    !tokenService.isRefreshInProgress()
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
