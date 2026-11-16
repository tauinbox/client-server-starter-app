import { HttpException, HttpStatus } from '@nestjs/common';
import type { CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import {
  HttpMetricsInterceptor,
  UNMATCHED_ROUTE
} from './http-metrics.interceptor';
import type { MetricsService } from '../metrics/metrics.service';
import { createMockExecutionContext } from '../../../common/testing/execution-context.mock';

const mockMetricsService: jest.Mocked<
  Pick<MetricsService, 'recordHttpRequest'>
> = {
  recordHttpRequest: jest.fn()
};

const makeContext = (template: string, method = 'GET', statusCode = 200) =>
  createMockExecutionContext({
    request: { route: { path: template }, method },
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
            { method: 'GET', route: '/api/v1/users', statusCode: 200 },
            expect.any(Number)
          );
          done();
        }
      });
  });

  it('labels by the matched route template, not by the raw path', (done) => {
    const handler: CallHandler = { handle: () => of('ok') };
    const context = createMockExecutionContext({
      request: {
        route: { path: '/api/v1/users/:id' },
        path: '/api/v1/users/someone@example.com',
        method: 'GET'
      },
      response: { statusCode: 200 }
    });

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
          { method: 'GET', route: '/api/v1/users/:id', statusCode: 200 },
          expect.any(Number)
        );
        done();
      }
    });
  });

  it('labels a request with no matched route as unmatched', (done) => {
    const handler: CallHandler = { handle: () => of('ok') };
    const context = createMockExecutionContext({
      request: { path: '/api/v1/someone@example.com', method: 'GET' },
      response: { statusCode: 200 }
    });

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
          { method: 'GET', route: UNMATCHED_ROUTE, statusCode: 200 },
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
            { method: 'GET', route: '/api/v1/users/:id', statusCode: 404 },
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
            { method: 'POST', route: '/api/v1/test', statusCode: 500 },
            expect.any(Number)
          );
          done();
        }
      });
  });
});
