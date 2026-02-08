import type { HttpErrorResponse } from '@angular/common/http';

export function shouldAttemptTokenRefresh(
  error: HttpErrorResponse,
  isExcluded: boolean
): boolean {
  return error.status === 401 && !isExcluded;
}
