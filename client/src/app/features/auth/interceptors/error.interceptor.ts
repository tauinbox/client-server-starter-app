import { inject } from '@angular/core';
import type {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@features/auth/context-tokens/error-notifications';

export const errorInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const snackBar = inject(MatSnackBar);

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      const silentMode = request.context.get(
        DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN
      );
      // 401 is handled by jwt interceptor (token refresh / logout)
      if (error.status !== 401 && !silentMode) {
        const errorMessage = getErrorMessageText(error);
        snackBar.open(errorMessage, 'Close', { duration: 5000 });
      }

      return throwError(() => error);
    })
  );
};

function getErrorMessageText(e: HttpErrorResponse): string {
  return e.error.message || e.message || `Error Code: ${e.status}`;
}
