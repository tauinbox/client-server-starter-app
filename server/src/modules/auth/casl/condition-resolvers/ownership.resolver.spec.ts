import { Logger } from '@nestjs/common';
import { OwnershipResolver } from './ownership.resolver';
import { ResolverContext } from './condition-resolver.interface';

describe('OwnershipResolver', () => {
  let resolver: OwnershipResolver;
  let logger: Logger;
  let ctx: ResolverContext;

  beforeEach(() => {
    resolver = new OwnershipResolver();
    logger = new Logger('OwnershipResolverSpec');
    ctx = { userId: 'user-1', permissionLabel: 'users:update:own', logger };
  });

  it('should expose key="ownership"', () => {
    expect(resolver.key).toBe('ownership');
  });

  it('should map userField to ctx.userId (happy path)', () => {
    const outcome = resolver.resolve({ userField: 'createdBy' }, ctx);

    expect(outcome).toEqual({ fragment: { createdBy: 'user-1' } });
    expect(outcome.skipPermission).toBeUndefined();
  });

  it('should support userField="id"', () => {
    const outcome = resolver.resolve({ userField: 'id' }, ctx);

    expect(outcome).toEqual({ fragment: { id: 'user-1' } });
  });

  it('should not fall back to a default field — empty string is mapped verbatim', () => {
    // Documents current behaviour: resolver does not validate userField shape.
    // Upstream DTO validation owns the non-empty contract.
    const outcome = resolver.resolve({ userField: '' }, ctx);

    expect(outcome).toEqual({ fragment: { '': 'user-1' } });
  });

  it('should propagate ctx.userId regardless of value (no caching across calls)', () => {
    const otherCtx: ResolverContext = { ...ctx, userId: 'user-2' };

    const a = resolver.resolve({ userField: 'createdBy' }, ctx);
    const b = resolver.resolve({ userField: 'createdBy' }, otherCtx);

    expect(a.fragment).toEqual({ createdBy: 'user-1' });
    expect(b.fragment).toEqual({ createdBy: 'user-2' });
  });

  it('should throw when value is missing (defensive — factory already filters null/undefined)', () => {
    // The factory in `casl-ability.factory.ts` skips null/undefined branches before
    // calling resolvers, so this path is unreachable in production. The test pins
    // current behaviour: a missing value would surface as a TypeError, not a
    // silent malformed fragment.
    expect(() =>
      // @ts-expect-error testing invalid input shape
      resolver.resolve(undefined, ctx)
    ).toThrow(TypeError);
    expect(() =>
      // @ts-expect-error testing invalid input shape
      resolver.resolve(null, ctx)
    ).toThrow(TypeError);
  });
});
