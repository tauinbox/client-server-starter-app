import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The 423 answer of every per-account brake. The exception filter copies
 * `retryAfter` into the Retry-After header.
 */
export function lockedException(
  message: string,
  errorKey: string,
  lockedUntil: Date
): HttpException {
  return new HttpException(
    {
      message,
      errorKey,
      lockedUntil: lockedUntil.toISOString(),
      retryAfter: Math.max(
        1,
        Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)
      )
    },
    HttpStatus.LOCKED
  );
}
