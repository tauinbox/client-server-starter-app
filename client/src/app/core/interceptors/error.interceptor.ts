import { inject } from '@angular/core';
import type {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { HttpClient, HttpContext } from '@angular/common/http';
import { switchMap, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { UserPermissionsResponse } from '@app/shared/types';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { RBAC_RETRY_CONTEXT } from '@core/context-tokens/rbac-retry';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';

export const errorInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const snackBar = inject(MatSnackBar);
  const http = inject(HttpClient);
  const authStore = inject(AuthStore);

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      const silentMode = request.context.get(
        DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN
      );
      const isRetry = request.context.get(RBAC_RETRY_CONTEXT);

      // On first 403: refresh user permissions so AuthStore.ability updates
      // reactively (RequirePermissionsDirective re-evaluates via effect()),
      // then retry the request once. If the retry also 403s the permission is
      // genuinely revoked — show a snackbar and propagate the retry error.
      if (error.status === 403 && !isRetry) {
        const permissionsCtx = new HttpContext()
          .set(RBAC_RETRY_CONTEXT, true)
          .set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

        return http
          .get<UserPermissionsResponse>(AuthApiEnum.Permissions, {
            context: permissionsCtx
          })
          .pipe(
            catchError(() => {
              // Permissions fetch itself failed — show snackbar for original 403
              if (!silentMode) {
                snackBar.open(getErrorMessageText(error), 'Close', {
                  duration: 5000
                });
              }
              return throwError(() => error);
            }),
            switchMap((response) => {
              authStore.setRules(response.rules);
              const retried = request.clone({
                context: request.context.set(RBAC_RETRY_CONTEXT, true)
              });
              return next(retried).pipe(
                catchError((retryError: HttpErrorResponse) => {
                  // Retry failed — permission is genuinely revoked
                  if (!silentMode) {
                    snackBar.open(getErrorMessageText(retryError), 'Close', {
                      duration: 5000
                    });
                  }
                  return throwError(() => retryError);
                })
              );
            })
          );
      }

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
  const serverMessage =
    typeof e.error === 'object' && e.error !== null
      ? (e.error as { message?: string }).message
      : undefined;

  return serverMessage || e.message || `Error Code: ${e.status}`;
}
