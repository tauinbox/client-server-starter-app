import type { ThrottlerOptions } from '@nestjs/throttler';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS
} from '@app/shared/constants';
import { MemoryThrottlerStorage } from './memory-throttler.storage';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import type { DecrementableThrottlerStorage } from './throttler-storage.interface';

interface AppThrottlerOptions {
  throttlers: ThrottlerOptions[];
  storage: DecrementableThrottlerStorage;
}

export function buildThrottlerOptions(
  redisUrl: string | undefined
): AppThrottlerOptions {
  const throttlers = [
    // SPA-wide soft ceiling — admin pages, autocompletes, infinite
    // scrolling and SSE reconnect all fan out into a handful of
    // requests per interaction. Per-route `@Throttle()` overrides
    // tighten this down to a few requests per minute on sensitive
    // public endpoints (login/register/reset-password/etc.).
    { ttl: 60000, limit: 120 },
    {
      // Applied globally but overridden on the login route to prevent a
      // single IP from accumulating enough failed attempts to trigger
      // account lockout (SEC-6). High global limit = effectively disabled
      // on all other routes.
      name: 'login-long-window',
      ttl: LOCKOUT_DURATION_MS,
      limit: MAX_FAILED_ATTEMPTS * 1000
    }
  ];

  const storage: DecrementableThrottlerStorage = redisUrl
    ? new RedisThrottlerStorage(redisUrl)
    : new MemoryThrottlerStorage();

  return { throttlers, storage };
}
