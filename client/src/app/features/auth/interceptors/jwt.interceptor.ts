import { inject } from '@angular/core';
import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const jwtInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const authService = inject(AuthService);
  const token = authService.getAccessToken();

  if (token) {
    request = addTokenToRequest(request, token);
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      // Check if the error is 401 Unauthorized and we're not trying to refresh already
      if (
        error.status === 401 &&
        !request.url.includes('refresh-token') &&
        !request.url.includes('login')
      ) {
        // Try to refresh the token
        return authService.refreshToken().pipe(
          switchMap((tokens) => {
            if (!tokens) {
              // If refresh fails, logout and redirect
              authService.logout();
              return throwError(() => error);
            }

            // Retry the original request with the new token
            return next(addTokenToRequest(request, tokens.access_token));
          }),
          catchError(() => {
            // If the refresh request fails, logout and propagate the error
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
