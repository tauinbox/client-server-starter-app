import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import {
  ERROR_STATUS,
  ErrorKeys,
  httpStatusText,
  type ErrorKey
} from '@app/shared/constants';
import { redactSensitiveQuery } from '@app/shared/utils/redact-url';
import { ErrorResponse } from './error-response.interface';

const PG_ERROR_MAP: Record<string, { key: ErrorKey; message: string }> = {
  '23505': {
    key: ErrorKeys.DB.UNIQUE_VIOLATION,
    message: 'A record with this value already exists'
  },
  '23503': {
    key: ErrorKeys.DB.FOREIGN_KEY_VIOLATION,
    message: 'Cannot complete operation due to related data'
  },
  '23502': {
    key: ErrorKeys.DB.NOT_NULL_VIOLATION,
    message: 'A required field is missing'
  },
  '22P02': {
    key: ErrorKeys.DB.INVALID_INPUT,
    message: 'Invalid input format'
  }
};

// RFC 6750 3.1: a request whose token was refused gets `invalid_token`; a
// request that carried no token gets the bare challenge.
const INVALID_TOKEN_KEYS: ReadonlySet<string> = new Set<ErrorKey>([
  ErrorKeys.AUTH.INVALID_TOKEN,
  ErrorKeys.AUTH.TOKEN_REVOKED,
  ErrorKeys.AUTH.TOKEN_INVALIDATED_ROTATION
]);

/** The envelope of an error key that the filter itself raises. */
function keyed(key: ErrorKey, message: string): ResolvedException {
  return { statusCode: ERROR_STATUS[key], message, errorKey: key };
}

/**
 * The envelope is closed: only the fields listed here reach the wire, so a key
 * added to an HttpException body stays invisible until it is forwarded here.
 */
interface ResolvedException {
  statusCode: number;
  message: string;
  errors?: string[];
  errorKey?: string;
  lockedUntil?: string;
  retryAfter?: number;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const path = httpAdapter.getRequestUrl(request) as string;

    const { statusCode, message, errors, errorKey, lockedUntil, retryAfter } =
      this.resolveException(exception);

    const body: ErrorResponse = {
      statusCode,
      message,
      error: httpStatusText(statusCode),
      timestamp: new Date().toISOString(),
      path,
      ...(errors && { errors }),
      ...(errorKey && { errorKey }),
      ...(lockedUntil && { lockedUntil }),
      ...(retryAfter !== undefined && { retryAfter })
    };

    const loggedPath = redactSensitiveQuery(path);
    if (statusCode >= 500) {
      this.logger.error(
        `${loggedPath} ${statusCode} — ${message}`,
        exception instanceof Error ? exception.stack : undefined
      );
    } else {
      this.logger.warn(`${loggedPath} ${statusCode} — ${message}`);
    }

    const response = ctx.getResponse<unknown>();

    // RFC 9110 15.5.2: a 401 MUST carry a challenge.
    if (statusCode === 401) {
      httpAdapter.setHeader(
        response,
        'WWW-Authenticate',
        errorKey && INVALID_TOKEN_KEYS.has(errorKey)
          ? 'Bearer error="invalid_token"'
          : 'Bearer'
      );
    }

    // Retry-After is the standard carrier of a retry delay. The body field
    // stays as well: no route exposes response headers through CORS, so a
    // browser cannot read this one.
    if (retryAfter !== undefined) {
      httpAdapter.setHeader(
        response,
        'Retry-After',
        String(Math.max(0, retryAfter))
      );
    }

    httpAdapter.reply(response, body, statusCode);
  }

  private resolveException(exception: unknown): ResolvedException {
    if (exception instanceof HttpException) {
      return this.handleHttpException(exception);
    }

    if (exception instanceof QueryFailedError) {
      return this.handleQueryFailedError(exception as QueryFailedError<Error>);
    }

    const clientError = this.exposedClientError(exception);
    if (clientError) {
      return clientError;
    }

    if (exception instanceof EntityNotFoundError) {
      return keyed(
        ErrorKeys.GENERAL.RESOURCE_NOT_FOUND,
        'The requested resource was not found'
      );
    }

    return keyed(
      ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR,
      'Internal server error'
    );
  }

  private handleHttpException(exception: HttpException): ResolvedException {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { statusCode, message: response };
    }

    const responseObj = response as Record<string, unknown>;
    const rawMessage = responseObj['message'];
    const errorKey = responseObj['errorKey'] as string | undefined;
    const rawLockedUntil = responseObj['lockedUntil'];
    const rawRetryAfter = responseObj['retryAfter'];
    const lockedUntil =
      typeof rawLockedUntil === 'string' ? rawLockedUntil : undefined;
    const retryAfter =
      typeof rawRetryAfter === 'number' && Number.isFinite(rawRetryAfter)
        ? rawRetryAfter
        : undefined;

    if (Array.isArray(rawMessage)) {
      const stringMessages = rawMessage.map(String);
      return {
        statusCode,
        message: stringMessages.join('. '),
        errors: stringMessages,
        errorKey,
        lockedUntil,
        retryAfter
      };
    }

    return {
      statusCode,
      message:
        typeof rawMessage === 'string'
          ? rawMessage
          : (exception.message ?? 'An error occurred'),
      errorKey,
      lockedUntil,
      retryAfter
    };
  }

  private handleQueryFailedError(
    exception: QueryFailedError<Error>
  ): ResolvedException {
    const { driverError } = exception;
    const code = 'code' in driverError ? String(driverError.code) : undefined;

    const mapped = code ? PG_ERROR_MAP[code] : undefined;
    if (mapped) {
      return keyed(mapped.key, mapped.message);
    }

    return keyed(
      ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR,
      'Internal server error'
    );
  }

  /**
   * An http-errors 4xx with `expose` set, as body-parser throws for a body over
   * the size limit. Nest maps only a SyntaxError (bad JSON) to a 400.
   */
  private exposedClientError(exception: unknown): ResolvedException | null {
    if (!(exception instanceof Error)) {
      return null;
    }
    const { status, expose } = exception as Error & {
      status?: unknown;
      expose?: unknown;
    };
    if (
      expose !== true ||
      typeof status !== 'number' ||
      status < 400 ||
      status >= 500
    ) {
      return null;
    }
    return { statusCode: status, message: exception.message };
  }
}
