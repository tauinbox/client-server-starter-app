import type { RequestHandler } from 'express';
import { isUuid } from '../utils/mock-id';

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
 * Envelope for a 400 that mirrors a class-validator rejection on the real
 * server. `GlobalExceptionFilter` turns the ValidationPipe's string[] into a
 * joined `message` plus the original array in `errors`, and the client keys off
 * `errors` to show a translated generic message instead of raw validator text.
 * A 400 the server raises from service logic carries no `errors` key and must
 * keep sending a bare `{ message, statusCode }` here.
 */
export function validationError(message: string | string[]): {
  message: string;
  errors: string[];
  statusCode: number;
  error: string;
} {
  const errors = Array.isArray(message) ? message : [message];
  return {
    message: errors.join('. '),
    errors,
    statusCode: 400,
    error: 'Bad Request'
  };
}
