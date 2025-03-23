import { inject } from '@angular/core';
import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';
import { TokenService } from '../services/token.service';
import { AuthService } from '../services/auth.service';

export const jwtInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const tokenService = inject(TokenService);
  const authService = inject(AuthService);
  const token = tokenService.getAccessToken();

  if (token) {
    request = addTokenToRequest(request, token);
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      // Check if the error is 401 Unauthorized and we're not trying to refresh already
      if (
        error.status === 401 &&
        !request.url.includes('refresh-token') &&
        !request.url.includes('login') &&
        !tokenService.isRefreshInProgress()
      ) {
        tokenService.startRefreshProcess();

        return authService.refreshToken().pipe(
          switchMap((tokens) => {
            if (!tokens) {
              authService.logout();
              return throwError(() => error);
            }

            return next(addTokenToRequest(request, tokens.access_token));
          }),
          catchError(() => {
            tokenService.endRefreshProcess(null);
            authService.logout();
            return throwError(() => error);
          })
        );
      }

      // For all other errors, just pass them through
      return throwError(() => error);
    })
  );
};

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
