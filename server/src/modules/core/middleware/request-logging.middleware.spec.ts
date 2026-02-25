import { RequestLoggingMiddleware } from './request-logging.middleware';
import { Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

type MockedResponse = {
  statusCode: number;
  getHeader: jest.Mock;
  on: jest.Mock;
};

function createMockResponse(statusCode = 200): MockedResponse & Response {
  const emitter = new EventEmitter();
  return {
    statusCode,
    getHeader: jest.fn().mockReturnValue('test-request-id'),
    on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
      return emitter;
    }),
    emit: emitter.emit.bind(emitter)
  } as MockedResponse & Response;
}

describe('RequestLoggingMiddleware', () => {
  let middleware: RequestLoggingMiddleware;
  let req: Partial<Request>;
  let res: MockedResponse & Response;
  let next: NextFunction;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    middleware = new RequestLoggingMiddleware();
    req = { method: 'GET', originalUrl: '/api/v1/users' };
    res = createMockResponse();
    next = jest.fn();

    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should call next()', () => {
    middleware.use(req as Request, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should log successful requests with Logger.log', () => {
    res.statusCode = 200;

    middleware.use(req as Request, res, next);
    res.emit('finish');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/v1/users 200')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[req-id: test-request-id]')
    );
  });

  it('should log 3xx responses with Logger.log', () => {
    res.statusCode = 301;

    middleware.use(req as Request, res, next);
    res.emit('finish');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('301'));
  });

  it('should log 4xx responses with Logger.warn', () => {
    res.statusCode = 404;

    middleware.use(req as Request, res, next);
    res.emit('finish');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/v1/users 404')
    );
  });

  it('should log 5xx responses with Logger.error', () => {
    res.statusCode = 500;

    middleware.use(req as Request, res, next);
    res.emit('finish');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/v1/users 500')
    );
  });

  it('should include duration in ms', () => {
    middleware.use(req as Request, res, next);
    res.emit('finish');

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\d+ms/));
  });

  it('should handle missing request id', () => {
    res.getHeader.mockReturnValue(undefined);

    middleware.use(req as Request, res, next);
    res.emit('finish');

    expect(logSpy).toHaveBeenCalledWith(
      expect.not.stringContaining('[req-id:')
    );
  });
});
