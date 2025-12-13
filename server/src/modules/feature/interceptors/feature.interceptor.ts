import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor
} from '@nestjs/common';
import { map, Observable, tap } from 'rxjs';

@Injectable()
export class FeatureInterceptor implements NestInterceptor {
  private readonly logger = new Logger(FeatureInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startTime = Date.now();
    this.logger.debug('Before handler execution');

    return next.handle().pipe(
      tap(() => {
        this.logger.debug(`After handler execution: ${Date.now() - startTime}ms`);
      }),
      map((data: Record<string, unknown>) => {
        if (data && typeof data === 'object') {
          const { sensitiveData, ...rest } = data;
          return { ...rest, isModifiedByInterceptor: true };
        }
        return data;
      })
    );
  }
}
