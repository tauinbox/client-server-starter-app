import { ExecutionContext, Type } from '@nestjs/common';

export interface MockExecutionContextOptions {
  request?: unknown;
  response?: unknown;
  handler?: () => unknown;
  class?: Type;
}

class DefaultMockContextClass {}

/**
 * Builds a minimal ExecutionContext for guard/interceptor unit tests. Only the
 * members those tests exercise (switchToHttp request/response, getHandler,
 * getClass) are implemented; the object is typed through Partial so no
 * double cast is needed.
 */
export function createMockExecutionContext(
  options: MockExecutionContextOptions = {}
): ExecutionContext {
  const {
    request = {},
    response = {},
    handler = () => undefined,
    class: contextClass = DefaultMockContextClass
  } = options;

  const context: Partial<ExecutionContext> = {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
      getResponse: <T>() => response as T,
      getNext: <T>() => undefined as T
    }),
    getHandler: () => handler,
    getClass: <T = unknown>() => contextClass as Type<T>
  };

  return context as ExecutionContext;
}
