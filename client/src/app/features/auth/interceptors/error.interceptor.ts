import { inject } from '@angular/core';
import type {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TokenService } from '../services/token.service';

export const errorInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const tokenService = inject(TokenService);
  const router = inject(Router);
  const snackBar = inject(MatSnackBar);

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      const errorMessage = handleHttpError(error, tokenService, router);

      snackBar.open(errorMessage, 'Close', { duration: 5000 });

      return throwError(() => new Error(errorMessage));
    })
  );
};

function handleHttpError(
  error: HttpErrorResponse,
  tokenService: TokenService,
  router: Router
): string {
  if (error.error instanceof ErrorEvent) {
    return `Error: ${error.error.message}`;
  }

  switch (error.status) {
    case 401:
      tokenService.logout();
      return 'Your session has expired. Please log in again.';
    case 403:
      void router.navigate(['/forbidden']);
      return 'You do not have permission to access this resource.';
    case 404:
      return 'Resource not found.';
    default:
      return error.error?.message || `Error Code: ${error.status}`;
  }
}
