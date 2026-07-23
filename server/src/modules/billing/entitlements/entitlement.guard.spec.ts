import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { EntitlementGuard } from './entitlement.guard';
import { EntitlementService } from './entitlement.service';
import { createMockExecutionContext } from '../../../common/testing/execution-context.mock';

describe('EntitlementGuard', () => {
  let guard: EntitlementGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let entitlements: jest.Mocked<Pick<EntitlementService, 'has'>>;

  function contextFor(userId: string | undefined): ExecutionContext {
    const req = { user: userId ? { userId } : undefined } as JwtAuthRequest;
    return createMockExecutionContext({ request: req });
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    entitlements = { has: jest.fn() };
    guard = new EntitlementGuard(
      // @ts-expect-error - partial mock: only Reflector.getAllAndOverride is used
      reflector,
      entitlements
    );
  });

  it('allows the route when no entitlement metadata is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(contextFor('user-1'))).resolves.toBe(true);
    expect(entitlements.has).not.toHaveBeenCalled();
  });

  it('allows the route when the caller has the capability', async () => {
    reflector.getAllAndOverride.mockReturnValue('reports');
    entitlements.has.mockResolvedValue(true);
    await expect(guard.canActivate(contextFor('user-1'))).resolves.toBe(true);
    expect(entitlements.has).toHaveBeenCalledWith('user-1', 'reports');
  });

  it('throws 403 when the caller lacks the capability', async () => {
    reflector.getAllAndOverride.mockReturnValue('priority-support');
    entitlements.has.mockResolvedValue(false);
    await expect(guard.canActivate(contextFor('user-1'))).rejects.toThrow(
      ForbiddenException
    );
  });

  it('throws 403 when there is no authenticated user', async () => {
    reflector.getAllAndOverride.mockReturnValue('reports');
    await expect(guard.canActivate(contextFor(undefined))).rejects.toThrow(
      ForbiddenException
    );
    expect(entitlements.has).not.toHaveBeenCalled();
  });
});
