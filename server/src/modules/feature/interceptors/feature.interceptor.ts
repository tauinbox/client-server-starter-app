import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable, tap } from 'rxjs';

// When dealing with JWT tokens - we can handle the decoding part with the interceptors
// while the guards should only focus on authorizing valid users

@Injectable()
export class FeatureInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const startTime = Date.now();
    console.log('[FeatureInterceptor] Before...');

    return next.handle().pipe(
      tap(() => {
        console.log(
          '[FeatureInterceptor] After...',
          `${Date.now() - startTime}ms`,
        );
      }),
      map((data) => {
        // Middleware handles the request differently, while interceptors allow to change the response data
        // right before it is sent to the client
        const { sensitiveData, ...rest } = data;
        return { ...rest, isModifiedByInterceptor: true };
      }),
      // we can also catch errors thrown by the controllers and remap them as well
    );
  }
}
