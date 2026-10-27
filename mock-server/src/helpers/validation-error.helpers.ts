import type { RequestHandler, Response } from 'express';
import { isUuid } from '../utils/mock-id';

/** Where a refused value came from: the server pipe answers each differently. */
export type ValidationLocation = 'body' | 'query';

/**
 * Mirrors `@Param('<name>', ParseUUIDPipe)`. The pipe runs after the guards but
 * before the handler, so a malformed id is a 400 whether or not the row exists —
 * mount this between the auth guard and the handler on every route whose server
 * counterpart carries the pipe.
 *
 * The pipe's default `exceptionFactory` throws a `BadRequestException` built
 * from a bare string, so the envelope carries no `errors` array.
 *
 */
export function requireUuid(...params: string[]): RequestHandler {
  return (req, res, next) => {
    for (const param of params) {
      if (!isUuid(String(req.params[param] ?? ''))) {
        // eslint-disable-next-line no-restricted-syntax -- ParseUUIDPipe sends this 400 with no key
        res.status(400).json({
          message: 'Validation failed (uuid is expected)',
          statusCode: 400,
          error: 'Bad Request'
        });
        return;
      }
    }
    next();
  };
}

/**
 * Body of an answer that mirrors a class-validator rejection on the real
 * server. `GlobalExceptionFilter` turns the ValidationPipe's string[] into a
 * joined `message` plus the original array in `errors`, and the client keys off
 * `errors` to show a translated generic message instead of raw validator text.
 * A refusal the server raises from service logic carries no `errors` key.
 */
export function validationError(message: string | string[]): {
  message: string;
  errors: string[];
} {
  const errors = Array.isArray(message) ? message : [message];
  return { message: errors.join('. '), errors };
}

/**
 * The status of a validation failure, as `ApiValidationPipe` answers it: 422
 * for a body that parsed but fails its DTO, 400 for a bad query value.
 */
export function validationStatus(location: ValidationLocation): 400 | 422 {
  return location === 'body' ? 422 : 400;
}

/** Mirrors a rejection of `ApiValidationPipe`. */
export function sendValidationError(
  res: Response,
  location: ValidationLocation,
  message: string | string[]
): void {
  res.status(validationStatus(location)).json(validationError(message));
}
