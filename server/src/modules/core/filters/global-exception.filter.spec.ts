import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import { GlobalExceptionFilter } from './global-exception.filter';
import { ErrorResponse } from './error-response.interface';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockHttpAdapter: {
    getRequestUrl: jest.Mock;
    reply: jest.Mock;
  };
  let mockHost: ArgumentsHost;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockHttpAdapter = {
      getRequestUrl: jest.fn().mockReturnValue('/api/v1/test'),
      reply: jest.fn()
    };

    const httpAdapterHost = {
      httpAdapter: mockHttpAdapter
    } as unknown as HttpAdapterHost;

    filter = new GlobalExceptionFilter(httpAdapterHost);

    const mockRequest = {};
    const mockResponse = {};
    mockHost = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse
      })
    } as unknown as ArgumentsHost;

    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function getResponseBody(): ErrorResponse {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return mockHttpAdapter.reply.mock.calls[0][1] as ErrorResponse;
  }

  function getResponseStatus(): number {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return mockHttpAdapter.reply.mock.calls[0][2] as number;
  }

  // --- Response shape ---

  it('should always include statusCode, message (string), error, timestamp, and path', () => {
    filter.catch(new Error('test'), mockHost);

    const body = getResponseBody();
    expect(body).toHaveProperty('statusCode');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('path');
    expect(typeof body.statusCode).toBe('number');
    expect(typeof body.message).toBe('string');
    expect(typeof body.error).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.path).toBe('string');
  });

  // --- HttpException subtypes ---

  it('should handle NotFoundException', () => {
    filter.catch(new NotFoundException('User not found'), mockHost);

    expect(getResponseStatus()).toBe(404);
    const body = getResponseBody();
    expect(body.statusCode).toBe(404);
    expect(body.message).toBe('User not found');
    expect(body.error).toBe('Not Found');
  });

  it('should handle BadRequestException', () => {
    filter.catch(new BadRequestException('Invalid input'), mockHost);

    expect(getResponseStatus()).toBe(400);
    const body = getResponseBody();
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe('Invalid input');
    expect(body.error).toBe('Bad Request');
  });

  it('should handle UnauthorizedException', () => {
    filter.catch(new UnauthorizedException(), mockHost);

    expect(getResponseStatus()).toBe(401);
    const body = getResponseBody();
    expect(body.statusCode).toBe(401);
    expect(body.message).toBe('Unauthorized');
    expect(body.error).toBe('Unauthorized');
  });

  it('should handle ConflictException', () => {
    filter.catch(new ConflictException('Already exists'), mockHost);

    expect(getResponseStatus()).toBe(409);
    const body = getResponseBody();
    expect(body.statusCode).toBe(409);
    expect(body.message).toBe('Already exists');
    expect(body.error).toBe('Conflict');
  });

  it('should handle ForbiddenException', () => {
    filter.catch(new ForbiddenException(), mockHost);

    expect(getResponseStatus()).toBe(403);
    const body = getResponseBody();
    expect(body.statusCode).toBe(403);
    expect(body.message).toBe('Forbidden');
    expect(body.error).toBe('Forbidden');
  });

  // --- Validation errors ---

  it('should handle ValidationPipe errors (message array)', () => {
    const exception = new BadRequestException({
      statusCode: 400,
      message: ['email must be an email', 'name should not be empty'],
      error: 'Bad Request'
    });

    filter.catch(exception, mockHost);

    expect(getResponseStatus()).toBe(400);
    const body = getResponseBody();
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe(
      'email must be an email. name should not be empty'
    );
    expect(body.errors).toEqual([
      'email must be an email',
      'name should not be empty'
    ]);
    expect(body.error).toBe('Bad Request');
  });

  // --- QueryFailedError ---

  it('should handle QueryFailedError with PG 23505 (unique_violation)', () => {
    const error = createQueryFailedError('23505');

    filter.catch(error, mockHost);

    expect(getResponseStatus()).toBe(409);
    const body = getResponseBody();
    expect(body.message).toBe('A record with this value already exists');
    expect(body.error).toBe('Conflict');
  });

  it('should handle QueryFailedError with PG 23503 (foreign_key_violation)', () => {
    const error = createQueryFailedError('23503');

    filter.catch(error, mockHost);

    expect(getResponseStatus()).toBe(409);
    const body = getResponseBody();
    expect(body.message).toBe('Cannot complete operation due to related data');
  });

  it('should handle QueryFailedError with PG 23502 (not_null_violation)', () => {
    const error = createQueryFailedError('23502');

    filter.catch(error, mockHost);

    expect(getResponseStatus()).toBe(400);
    const body = getResponseBody();
    expect(body.message).toBe('A required field is missing');
  });

  it('should handle QueryFailedError with PG 22P02 (invalid_text_representation)', () => {
    const error = createQueryFailedError('22P02');

    filter.catch(error, mockHost);

    expect(getResponseStatus()).toBe(400);
    const body = getResponseBody();
    expect(body.message).toBe('Invalid input format');
  });

  it('should handle QueryFailedError with unknown PG code as 500', () => {
    const error = createQueryFailedError('99999');

    filter.catch(error, mockHost);

    expect(getResponseStatus()).toBe(500);
    const body = getResponseBody();
    expect(body.message).toBe('Internal server error');
  });

  // --- EntityNotFoundError ---

  it('should handle EntityNotFoundError as 404', () => {
    const error = new EntityNotFoundError('User', { id: 1 });

    filter.catch(error, mockHost);

    expect(getResponseStatus()).toBe(404);
    const body = getResponseBody();
    expect(body.message).toBe('The requested resource was not found');
    expect(body.error).toBe('Not Found');
  });

  // --- Unknown errors ---

  it('should handle unknown Error as 500 without leaking details', () => {
    filter.catch(new Error('database connection lost'), mockHost);

    expect(getResponseStatus()).toBe(500);
    const body = getResponseBody();
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(body.message).not.toContain('database');
  });

  it('should handle non-Error thrown value as 500', () => {
    filter.catch('unexpected string error', mockHost);

    expect(getResponseStatus()).toBe(500);
    const body = getResponseBody();
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
  });

  // --- Logging ---

  it('should log 5xx errors with logger.error', () => {
    const error = new Error('something broke');
    filter.catch(error, mockHost);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('500'),
      error.stack
    );
    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });

  it('should log 4xx errors with logger.warn', () => {
    filter.catch(new NotFoundException('Not found'), mockHost);

    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });
});

function createQueryFailedError(pgCode: string): QueryFailedError {
  const driverError = new Error('query failed') as Error & { code: string };
  driverError.code = pgCode;
  return new QueryFailedError('SELECT 1', [], driverError);
}
