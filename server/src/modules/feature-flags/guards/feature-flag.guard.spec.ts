import { Reflector } from '@nestjs/core';
import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { FeatureFlagGuard } from './feature-flag.guard';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';
import { createMockExecutionContext } from '../../../common/testing/execution-context.mock';

function makeContext(userId: string | undefined): ExecutionContext {
  const handler = function handler() {};
  const cls = class Cls {};
  const req = {
    user: userId ? { userId } : undefined
  };
  return createMockExecutionContext({ request: req, handler, class: cls });
}

describe('FeatureFlagGuard', () => {
  let guard: FeatureFlagGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let resolver: jest.Mocked<
    Pick<FeatureFlagResolverService, 'buildResolverUser' | 'isEnabledForUser'>
  >;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    resolver = {
      buildResolverUser: jest.fn().mockResolvedValue({
        userId: 'u-1',
        email: 'a@b.com',
        createdAt: new Date(),
        roles: []
      }),
      isEnabledForUser: jest.fn()
    };
    guard = new FeatureFlagGuard(
      // @ts-expect-error - partial mock: only Reflector.getAllAndOverride is used
      reflector,
      resolver
    );
  });

  it('passes through when no @RequireFeature metadata is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(makeContext('u-1'))).resolves.toBe(true);
  });

  it('returns 200 (true) when the flag is enabled', async () => {
    reflector.getAllAndOverride.mockReturnValue('new-dashboard');
    resolver.isEnabledForUser.mockResolvedValue(true);
    await expect(guard.canActivate(makeContext('u-1'))).resolves.toBe(true);
    expect(resolver.buildResolverUser).toHaveBeenCalledWith('u-1');
  });

  it('throws NotFoundException when flag is disabled (anti-enumeration)', async () => {
    reflector.getAllAndOverride.mockReturnValue('new-dashboard');
    resolver.isEnabledForUser.mockResolvedValue(false);
    await expect(guard.canActivate(makeContext('u-1'))).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('throws NotFoundException when caller is anonymous', async () => {
    reflector.getAllAndOverride.mockReturnValue('new-dashboard');
    await expect(
      guard.canActivate(makeContext(undefined))
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
