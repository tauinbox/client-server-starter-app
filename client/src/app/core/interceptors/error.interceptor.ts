import { inject } from '@angular/core';
import type {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { HttpContext } from '@angular/common/http';
import { switchMap, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { RBAC_RETRY_CONTEXT } from '@core/context-tokens/rbac-retry';
import { RbacMetadataService } from '@features/auth/services/rbac-metadata.service';
import { RbacMetadataStore } from '@features/auth/store/rbac-metadata.store';

export const errorInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const snackBar = inject(MatSnackBar);
  const rbacMetadataService = inject(RbacMetadataService);
  const rbacMetadataStore = inject(RbacMetadataStore);

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      const silentMode = request.context.get(
        DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN
      );
      const isRetry = request.context.get(RBAC_RETRY_CONTEXT);

      // On first 403: refresh RBAC metadata and retry once
      if (error.status === 403 && !isRetry) {
        const metadataCtx = new HttpContext()
          .set(RBAC_RETRY_CONTEXT, true)
          .set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);

        return rbacMetadataService.getMetadata({ context: metadataCtx }).pipe(
          switchMap(({ resources, actions }) => {
            rbacMetadataStore.setMetadata(resources, actions);
            const retried = request.clone({
              context: request.context.set(RBAC_RETRY_CONTEXT, true)
            });
            return next(retried);
          }),
          catchError(() => {
            if (!silentMode) {
              snackBar.open(getErrorMessageText(error), 'Close', {
                duration: 5000
              });
            }
            return throwError(() => error);
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
