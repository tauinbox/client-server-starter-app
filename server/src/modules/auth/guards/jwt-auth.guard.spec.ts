import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let getAllAndOverride: jest.Mock;
  let reflector: Reflector;
  let context: ExecutionContext;
  let superCanActivate: jest.SpyInstance;

  function buildContext(): ExecutionContext {
    return {
      getHandler: jest.fn(() => 'handler-ref'),
      getClass: jest.fn(() => 'class-ref'),
      switchToHttp: jest.fn()
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    getAllAndOverride = jest.fn();
    reflector = { getAllAndOverride } as unknown as Reflector;

    guard = new JwtAuthGuard(reflector);
    context = buildContext();

    // Stub the parent AuthGuard('jwt').canActivate so we don't bootstrap
    // passport's strategy lookup during a unit test.
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(guard)) as {
      canActivate: () => boolean;
    };
    superCanActivate = jest.spyOn(proto, 'canActivate').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns true and skips JWT validation when handler has @Public() metadata', () => {
    getAllAndOverride.mockImplementation(
      (key: string) => key === IS_PUBLIC_KEY
    );

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      'handler-ref',
      'class-ref'
    ]);
    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it('delegates to passport AuthGuard("jwt") when route is not public', () => {
    getAllAndOverride.mockReturnValue(false);

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(superCanActivate).toHaveBeenCalledWith(context);
  });

  it('checks both handler and class metadata so @Public() on controller propagates', () => {
    getAllAndOverride.mockImplementation(
      (key: string) => key === IS_PUBLIC_KEY
    );

    void guard.canActivate(context);

    expect(getAllAndOverride).toHaveBeenCalledWith(
      IS_PUBLIC_KEY,
      expect.arrayContaining(['handler-ref', 'class-ref'])
    );
  });

  it('treats undefined metadata as not public', () => {
    getAllAndOverride.mockReturnValue(undefined);

    void guard.canActivate(context);

    expect(superCanActivate).toHaveBeenCalledWith(context);
  });

  describe('@OptionalAuth()', () => {
    it('invokes the JWT strategy so req.user gets populated when the token is valid', async () => {
      getAllAndOverride.mockImplementation(
        (key: string) => key === IS_OPTIONAL_AUTH_KEY
      );
      superCanActivate.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivate).toHaveBeenCalledWith(context);
    });

    it('swallows JWT failures and still returns true (no/invalid/expired/revoked token)', async () => {
      getAllAndOverride.mockImplementation(
        (key: string) => key === IS_OPTIONAL_AUTH_KEY
      );
      superCanActivate.mockRejectedValue(new Error('Unauthorized'));

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivate).toHaveBeenCalledWith(context);
    });

    it('@Public() wins when combined with @OptionalAuth() — strategy is not invoked', () => {
      getAllAndOverride.mockReturnValue(true); // both keys true

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivate).not.toHaveBeenCalled();
    });
  });
});
