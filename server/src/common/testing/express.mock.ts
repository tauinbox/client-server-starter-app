import type { Request, Response } from 'express';

/**
 * Builds a partial Express Request for unit tests. The returned value is typed
 * as `Request & T` so callers can read the properties they supplied without a
 * cast; only those properties exist at runtime. The single `@ts-expect-error`
 * localises the unavoidable partial-mock gap of the very large Request type.
 */
export function createMockRequest<T extends object>(props: T): Request & T {
  // @ts-expect-error - partial Express Request for unit tests
  return { ...props };
}

/**
 * Builds a partial Express Response for unit tests, typed as `Response & T`.
 * See createMockRequest for the rationale.
 */
export function createMockResponse<T extends object>(props: T): Response & T {
  // @ts-expect-error - partial Express Response for unit tests
  return { ...props };
}
