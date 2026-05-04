import { Logger } from '@nestjs/common';
import { UserAttrResolver } from './user-attr.resolver';
import { ResolverContext } from './condition-resolver.interface';

describe('UserAttrResolver', () => {
  let resolver: UserAttrResolver;
  let logger: Logger;
  let warnSpy: jest.SpyInstance;
  let ctx: ResolverContext;

  beforeEach(() => {
    resolver = new UserAttrResolver();
    logger = new Logger('UserAttrResolverSpec');
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation();
    ctx = { userId: 'user-42', permissionLabel: 'users:read', logger };
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('should expose key="userAttr"', () => {
    expect(resolver.key).toBe('userAttr');
  });

  it('should map each field to the matching user attribute (happy path)', () => {
    const outcome = resolver.resolve({ ownerId: 'id', createdBy: 'id' }, ctx);

    expect(outcome).toEqual({
      fragment: { ownerId: 'user-42', createdBy: 'user-42' }
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should produce an empty fragment for an empty record', () => {
    const outcome = resolver.resolve({}, ctx);

    expect(outcome).toEqual({ fragment: {} });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should skip and warn when the attribute name is unknown', () => {
    const outcome = resolver.resolve({ ownerId: 'email' }, ctx);

    expect(outcome).toEqual({ fragment: {} });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('email'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ownerId'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('user-42'));
  });

  it('should skip and warn when the attribute name is not a string', () => {
    const outcome = resolver.resolve({ ownerId: 123, createdBy: 'id' }, ctx);

    expect(outcome).toEqual({ fragment: { createdBy: 'user-42' } });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ownerId'));
  });

  it('should skip and warn when the attribute name is null/undefined', () => {
    const outcome = resolver.resolve(
      // Field shape allows arbitrary `unknown` values from external storage.
      { a: null, b: undefined, c: 'id' },
      ctx
    );

    expect(outcome).toEqual({ fragment: { c: 'user-42' } });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('should mix valid and invalid attributes within the same record', () => {
    const outcome = resolver.resolve({ ownerId: 'id', orgId: 'unknown' }, ctx);

    expect(outcome).toEqual({ fragment: { ownerId: 'user-42' } });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('should not return skipPermission for any input', () => {
    const outcome = resolver.resolve({ ownerId: 'id' }, ctx);
    expect(outcome.skipPermission).toBeUndefined();
  });
});
