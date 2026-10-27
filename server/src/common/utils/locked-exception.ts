import type { ErrorKey } from '@app/shared/constants';
import { ApiError } from '../errors/api-error';

/**
 * The answer of every per-account brake. The exception filter copies
 * `retryAfter` into the Retry-After header.
 */
export function lockedException(
  message: string,
  errorKey: ErrorKey,
  lockedUntil: Date
): ApiError {
  return new ApiError(errorKey, message, {
    lockedUntil: lockedUntil.toISOString(),
    retryAfter: Math.max(
      1,
      Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)
    )
  });
}
