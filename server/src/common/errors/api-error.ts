import { HttpException, type HttpExceptionOptions } from '@nestjs/common';
import { ERROR_STATUS, type ErrorKey } from '@app/shared/constants';

/**
 * The one way to send an error key. The status comes from `ERROR_STATUS`, so
 * a key has the same status on every route. `extra` adds fields to the body,
 * for example `lockedUntil`; the exception filter decides which reach the wire.
 */
export class ApiError extends HttpException {
  readonly errorKey: ErrorKey;

  constructor(
    errorKey: ErrorKey,
    message: string,
    extra: Record<string, unknown> = {},
    options?: HttpExceptionOptions
  ) {
    super({ ...extra, message, errorKey }, ERROR_STATUS[errorKey], options);
    this.errorKey = errorKey;
  }
}
