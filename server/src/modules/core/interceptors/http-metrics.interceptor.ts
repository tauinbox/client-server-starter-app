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
    const route = this.normalizeRoute(req.path);
    this.metricsService.recordHttpRequest(
      req.method,
      route,
      statusCode,
      durationMs
    );
  }

  private normalizeRoute(path: string): string {
    return path
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '/:id'
      )
      .replace(/\/\d+/g, '/:id');
  }
}
