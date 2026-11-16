import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();

          this.record(req, res.statusCode, Date.now() - start);
        },
        error: (err: unknown) => {
          const statusCode =
            err instanceof HttpException ? err.getStatus() : 500;

          this.record(req, statusCode, Date.now() - start);
        }
      })
    );
  }

  private record(req: Request, statusCode: number, durationMs: number): void {
    this.metricsService.recordHttpRequest(
      { method: req.method, route: routeTemplate(req.route), statusCode },
      durationMs
    );
  }
}

export const UNMATCHED_ROUTE = 'unmatched';

// The raw path holds what the caller sent (an email, an IP address, any
// string), so the label is the template that Express matched.
function routeTemplate(route: unknown): string {
  return typeof route === 'object' &&
    route !== null &&
    'path' in route &&
    typeof route.path === 'string'
    ? route.path
    : UNMATCHED_ROUTE;
}
