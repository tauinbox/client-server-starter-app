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
import type { UserPermissionsResponse } from '@app/shared/types';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { RBAC_RETRY_CONTEXT } from '@core/context-tokens/rbac-retry';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const asInt = Number.parseInt(value, 10);
  if (Number.isFinite(asInt) && asInt > 0) return asInt;
  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) {
    const diff = Math.ceil((asDate - Date.now()) / 1000);
    return diff > 0 ? diff : null;
  }
  return null;
}

export const errorInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const notify = inject(NotifyService);
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
                notify.error(error);
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
                    notify.error(retryError);
                  }
                  return throwError(() => retryError);
                })
              );
            })
          );
      }

      // 401 is handled by jwt interceptor (token refresh / logout)
      if (error.status !== 401 && !silentMode) {
        if (error.status === 429) {
          // Server's ThrottlerException payload has no errorKey/translated
          // message; show a friendly localized one and surface the
          // Retry-After header when present.
          const retryAfter = parseRetryAfterSeconds(
            error.headers?.get('Retry-After')
          );
          if (retryAfter !== null) {
            notify.warn('errors.general.tooManyRequestsRetry', {
              seconds: retryAfter
            });
          } else {
            notify.warn('errors.general.tooManyRequests');
          }
        } else {
          notify.error(error);
        }
      }

      return throwError(() => error);
    })
  );
};
