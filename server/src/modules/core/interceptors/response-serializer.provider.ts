import { ClassSerializerInterceptor, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

/**
 * Applies the class-transformer rules (`@Exclude`, `@Expose` groups) of every
 * returned entity on every route, SSE events included. A test that mounts a
 * controller without `CoreModule` adds this provider to get the same output.
 */
export const RESPONSE_SERIALIZER: Provider = {
  provide: APP_INTERCEPTOR,
  useClass: ClassSerializerInterceptor
};
