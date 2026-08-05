import { TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

/**
 * Keeps the rate-limit counters inside this application instance.
 *
 * Without Redis - how CI runs - every app already gets its own in-memory store,
 * so suites never spend each other's budget. A Redis-backed run shares one store
 * across every worker, and `/auth/login` allows 3 per minute and 4 per 15
 * minutes for one IP: two suites that each register and log in from 127.0.0.1
 * are enough to answer 429 to whichever arrives second. Suites that assert on
 * rate limiting must not use this.
 */
export function withPrivateThrottlerStorage(
  builder: TestingModuleBuilder
): TestingModuleBuilder {
  return builder
    .overrideProvider(ThrottlerStorage)
    .useClass(ThrottlerStorageService);
}
