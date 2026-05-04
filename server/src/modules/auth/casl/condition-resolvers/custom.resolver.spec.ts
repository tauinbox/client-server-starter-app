import { Logger } from '@nestjs/common';
import { CustomResolver } from './custom.resolver';
import { ResolverContext } from './condition-resolver.interface';

describe('CustomResolver', () => {
  let resolver: CustomResolver;
  let logger: Logger;
  let warnSpy: jest.SpyInstance;
  let ctx: ResolverContext;

  beforeEach(() => {
    resolver = new CustomResolver();
    logger = new Logger('CustomResolverSpec');
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation();
    ctx = { userId: 'user-1', permissionLabel: 'users:read', logger };
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('should expose key="custom"', () => {
    expect(resolver.key).toBe('custom');
  });

  it('should parse and return the JSON fragment (happy path)', () => {
    const outcome = resolver.resolve(
      '{"status":{"$in":["active","pending"]}}',
      ctx
    );

    expect(outcome).toEqual({
      fragment: { status: { $in: ['active', 'pending'] } }
    });
    expect(outcome.skipPermission).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should return an empty fragment for an empty JSON object', () => {
    const outcome = resolver.resolve('{}', ctx);

    expect(outcome).toEqual({ fragment: {} });
    expect(outcome.skipPermission).toBeUndefined();
  });

  it('should skip (not veto) when JSON is malformed and warn', () => {
    const outcome = resolver.resolve('{not-valid-json', ctx);

    // Invalid JSON should log a warning but NOT skip the entire permission —
    // the permission falls back to whatever other resolvers contribute.
    expect(outcome).toEqual({});
    expect(outcome.skipPermission).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid JSON')
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('user-1'));
  });

  it('should skip (not veto) when value is an empty string', () => {
    const outcome = resolver.resolve('', ctx);

    expect(outcome).toEqual({});
    expect(outcome.skipPermission).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid JSON')
    );
  });

  describe('denied MongoQuery operators', () => {
    it.each([
      ['$where', '{"$where":"function(){return true}"}'],
      ['$function', '{"$function":{"body":"x"}}'],
      ['$expr', '{"$expr":{"$gt":["$a","$b"]}}']
    ])('should veto entire permission when %s is at top level', (op, json) => {
      const outcome = resolver.resolve(json, ctx);

      expect(outcome.skipPermission).toBe(true);
      expect(outcome.fragment).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(op));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('users:read')
      );
    });

    it('should veto when $where is nested inside $or', () => {
      const outcome = resolver.resolve(
        '{"$or":[{"status":"active"},{"$where":"hack"}]}',
        ctx
      );

      expect(outcome.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('$where'));
    });

    it('should veto when $expr is deeply nested inside $and', () => {
      const outcome = resolver.resolve(
        '{"$and":[{"a":1},{"b":{"c":{"$expr":"x"}}}]}',
        ctx
      );

      expect(outcome.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('$expr'));
    });
  });

  describe('prototype-pollution keys', () => {
    it.each([
      ['__proto__', '{"__proto__":{"admin":true}}'],
      ['constructor', '{"constructor":{"prototype":{"admin":true}}}'],
      ['prototype', '{"prototype":{"admin":true}}']
    ])('should veto when %s is at top level', (key, json) => {
      const outcome = resolver.resolve(json, ctx);

      expect(outcome.skipPermission).toBe(true);
      expect(outcome.fragment).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(key));
    });

    it('should veto when __proto__ is nested inside another field', () => {
      const outcome = resolver.resolve(
        '{"profile":{"settings":{"__proto__":{"role":"admin"}}}}',
        ctx
      );

      expect(outcome.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('__proto__')
      );
    });

    it('should veto when constructor is nested inside an array element', () => {
      const outcome = resolver.resolve(
        '{"$or":[{"a":1},{"constructor":{"x":1}}]}',
        ctx
      );

      expect(outcome.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('constructor')
      );
    });
  });
});
