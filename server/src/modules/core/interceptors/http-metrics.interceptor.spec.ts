import { HttpException, HttpStatus } from '@nestjs/common';
import type { CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import type { MetricsService } from '../metrics/metrics.service';
import { createMockExecutionContext } from '../../../common/testing/execution-context.mock';

const mockMetricsService: jest.Mocked<
  Pick<MetricsService, 'recordHttpRequest'>
> = {
  recordHttpRequest: jest.fn()
};

const makeContext = (path: string, method = 'GET', statusCode = 200) =>
  createMockExecutionContext({
    request: { path, method },
    response: { statusCode }
  });

describe('HttpMetricsInterceptor', () => {
  let interceptor: HttpMetricsInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    // @ts-expect-error - partial mock: only recordHttpRequest is used
    interceptor = new HttpMetricsInterceptor(mockMetricsService);
  });

  it('records successful request with correct route and status', (done) => {
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor
      .intercept(makeContext('/api/v1/users', 'GET', 200), handler)
      .subscribe({
        complete: () => {
          expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
            'GET',
            '/api/v1/users',
            200,
            expect.any(Number)
          );
          done();
        }
      });
  });

  it('normalizes UUID path segments to :id', (done) => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor
      .intercept(makeContext(`/api/v1/users/${uuid}`, 'GET', 200), handler)
      .subscribe({
        complete: () => {
          expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
            'GET',
            '/api/v1/users/:id',
            200,
            expect.any(Number)
          );
          done();
        }
      });
  });

  it('records error status code from HttpException', (done) => {
    const handler: CallHandler = {
      handle: () =>
        throwError(() => new HttpException('Not found', HttpStatus.NOT_FOUND))
    };

    interceptor
      .intercept(makeContext('/api/v1/users/:id', 'GET', 200), handler)
      .subscribe({
        error: () => {
          expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
            'GET',
            '/api/v1/users/:id',
            404,
            expect.any(Number)
          );
          done();
        }
      });
  });

  it('records 500 for non-HttpException errors', (done) => {
    const handler: CallHandler = {
      handle: () => throwError(() => new Error('unexpected'))
    };

    interceptor
      .intercept(makeContext('/api/v1/test', 'POST', 200), handler)
      .subscribe({
        error: () => {
          expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
            'POST',
            '/api/v1/test',
            500,
            expect.any(Number)
          );
          done();
        }
      });
  });
});
