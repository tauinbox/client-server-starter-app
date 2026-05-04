import { Logger } from '@nestjs/common';
import { FieldMatchResolver } from './field-match.resolver';
import { ResolverContext } from './condition-resolver.interface';

describe('FieldMatchResolver', () => {
  let resolver: FieldMatchResolver;
  let logger: Logger;
  let ctx: ResolverContext;

  beforeEach(() => {
    resolver = new FieldMatchResolver();
    logger = new Logger('FieldMatchResolverSpec');
    ctx = { userId: 'user-1', permissionLabel: 'users:read', logger };
  });

  it('should expose key="fieldMatch"', () => {
    expect(resolver.key).toBe('fieldMatch');
  });

  it('should wrap each field in a $in clause (happy path)', () => {
    const outcome = resolver.resolve(
      { status: ['active', 'pending'], department: ['eng'] },
      ctx
    );

    expect(outcome).toEqual({
      fragment: {
        status: { $in: ['active', 'pending'] },
        department: { $in: ['eng'] }
      }
    });
  });

  it('should produce an empty fragment for an empty record', () => {
    const outcome = resolver.resolve({}, ctx);

    expect(outcome).toEqual({ fragment: {} });
  });

  it('should drop fields whose value is an empty array', () => {
    const outcome = resolver.resolve({ status: [], department: ['eng'] }, ctx);

    expect(outcome).toEqual({ fragment: { department: { $in: ['eng'] } } });
  });

  it('should drop fields whose value is not an array (malformed input)', () => {
    const outcome = resolver.resolve(
      // @ts-expect-error testing invalid input shape — non-array slipping past DTO
      { status: 'active', department: ['eng'] },
      ctx
    );

    expect(outcome).toEqual({ fragment: { department: { $in: ['eng'] } } });
  });

  it('should drop fields whose value is null/undefined', () => {
    const outcome = resolver.resolve(
      // @ts-expect-error testing invalid input shape
      { a: null, b: undefined, c: ['ok'] },
      ctx
    );

    expect(outcome).toEqual({ fragment: { c: { $in: ['ok'] } } });
  });

  it('should preserve mixed primitive value types inside the array', () => {
    const outcome = resolver.resolve(
      { count: [1, 2, 3], flag: [true, false] },
      ctx
    );

    expect(outcome).toEqual({
      fragment: {
        count: { $in: [1, 2, 3] },
        flag: { $in: [true, false] }
      }
    });
  });

  it('should not return skipPermission for any input', () => {
    const outcome = resolver.resolve({ status: ['active'] }, ctx);
    expect(outcome.skipPermission).toBeUndefined();
  });
});
