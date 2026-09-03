import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { ErrorResponse } from './error-response.interface';

const PG_ERROR_MAP: Record<
  string,
  { statusCode: number; message: string; errorKey: string }
> = {
  '23505': {
    statusCode: HttpStatus.CONFLICT,
    message: 'A record with this value already exists',
    errorKey: ErrorKeys.DB.UNIQUE_VIOLATION
  },
  '23503': {
    statusCode: HttpStatus.CONFLICT,
    message: 'Cannot complete operation due to related data',
    errorKey: ErrorKeys.DB.FOREIGN_KEY_VIOLATION
  },
  '23502': {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'A required field is missing',
    errorKey: ErrorKeys.DB.NOT_NULL_VIOLATION
  },
  '22P02': {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Invalid input format',
    errorKey: ErrorKeys.DB.INVALID_INPUT
  }
};

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
      error: HttpStatus[statusCode]
        ? this.getHttpStatusText(statusCode)
        : 'Internal Server Error',
      timestamp: new Date().toISOString(),
      path,
      ...(errors && { errors }),
      ...(errorKey && { errorKey }),
      ...(lockedUntil && { lockedUntil }),
      ...(retryAfter !== undefined && { retryAfter })
    };

    if (statusCode >= 500) {
      this.logger.error(
        `${path} ${statusCode} — ${message}`,
        exception instanceof Error ? exception.stack : undefined
      );
    } else {
      this.logger.warn(`${path} ${statusCode} — ${message}`);
    }

    const response = ctx.getResponse<unknown>();

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

    if (exception instanceof EntityNotFoundError) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        message: 'The requested resource was not found',
        errorKey: ErrorKeys.GENERAL.RESOURCE_NOT_FOUND
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      errorKey: ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR
    };
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

    if (code && PG_ERROR_MAP[code]) {
      return PG_ERROR_MAP[code];
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      errorKey: ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR
    };
  }

  private getHttpStatusText(statusCode: number): string {
    const statusTexts: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      408: 'Request Timeout',
      409: 'Conflict',
      410: 'Gone',
      413: 'Payload Too Large',
      415: 'Unsupported Media Type',
      422: 'Unprocessable Entity',
      423: 'Locked',
      428: 'Precondition Required',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      501: 'Not Implemented',
      502: 'Bad Gateway',
      503: 'Service Unavailable'
    };

    return statusTexts[statusCode] ?? 'Internal Server Error';
  }
}
