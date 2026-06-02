import { Logger } from '@nestjs/common';
import { resolveConditions, ResolverContext } from './resolve-conditions';

describe('resolveConditions', () => {
  let logger: Logger;
  let warnSpy: jest.SpyInstance;
  let ctx: ResolverContext;

  beforeEach(() => {
    logger = new Logger('ResolveConditionsSpec');
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation();
    ctx = { userId: 'user-1', permissionLabel: 'users:update', logger };
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('empty / missing branches', () => {
    it('should produce an empty query for empty conditions', () => {
      expect(resolveConditions({}, ctx)).toEqual({
        query: {},
        skipPermission: false
      });
    });

    it('should ignore the effect key (handled by the factory ordering)', () => {
      expect(resolveConditions({ effect: 'deny' }, ctx)).toEqual({
        query: {},
        skipPermission: false
      });
    });
  });

  describe('ownership', () => {
    it('should map userField to ctx.userId (happy path)', () => {
      expect(
        resolveConditions({ ownership: { userField: 'createdBy' } }, ctx)
      ).toEqual({ query: { createdBy: 'user-1' }, skipPermission: false });
    });

    it('should support userField="id"', () => {
      expect(
        resolveConditions({ ownership: { userField: 'id' } }, ctx).query
      ).toEqual({ id: 'user-1' });
    });

    it('should map an empty userField verbatim (DTO owns the non-empty contract)', () => {
      expect(
        resolveConditions({ ownership: { userField: '' } }, ctx).query
      ).toEqual({ '': 'user-1' });
    });

    it('should propagate the ctx.userId of the call (no caching across calls)', () => {
      const a = resolveConditions(
        { ownership: { userField: 'createdBy' } },
        ctx
      );
      const b = resolveConditions(
        { ownership: { userField: 'createdBy' } },
        { ...ctx, userId: 'user-2' }
      );

      expect(a.query).toEqual({ createdBy: 'user-1' });
      expect(b.query).toEqual({ createdBy: 'user-2' });
    });
  });

  describe('fieldMatch', () => {
    it('should wrap each field in a $in clause (happy path)', () => {
      expect(
        resolveConditions(
          {
            fieldMatch: { status: ['active', 'pending'], department: ['eng'] }
          },
          ctx
        ).query
      ).toEqual({
        status: { $in: ['active', 'pending'] },
        department: { $in: ['eng'] }
      });
    });

    it('should produce an empty query for an empty record', () => {
      expect(resolveConditions({ fieldMatch: {} }, ctx).query).toEqual({});
    });

    it('should drop fields whose value is an empty array', () => {
      expect(
        resolveConditions(
          { fieldMatch: { status: [], department: ['eng'] } },
          ctx
        ).query
      ).toEqual({ department: { $in: ['eng'] } });
    });

    it('should drop fields whose value is not an array (malformed input)', () => {
      expect(
        resolveConditions(
          // @ts-expect-error testing invalid input shape — non-array slipping past DTO
          { fieldMatch: { status: 'active', department: ['eng'] } },
          ctx
        ).query
      ).toEqual({ department: { $in: ['eng'] } });
    });

    it('should drop fields whose value is null/undefined', () => {
      expect(
        resolveConditions(
          // @ts-expect-error testing invalid input shape
          { fieldMatch: { a: null, b: undefined, c: ['ok'] } },
          ctx
        ).query
      ).toEqual({ c: { $in: ['ok'] } });
    });

    it('should preserve mixed primitive value types inside the array', () => {
      expect(
        resolveConditions(
          { fieldMatch: { count: [1, 2, 3], flag: [true, false] } },
          ctx
        ).query
      ).toEqual({
        count: { $in: [1, 2, 3] },
        flag: { $in: [true, false] }
      });
    });

    it('should not veto for any input', () => {
      expect(
        resolveConditions({ fieldMatch: { status: ['active'] } }, ctx)
          .skipPermission
      ).toBe(false);
    });
  });

  describe('userAttr', () => {
    beforeEach(() => {
      ctx = { ...ctx, userId: 'user-42' };
    });

    it('should map each field to the matching user attribute (happy path)', () => {
      const result = resolveConditions(
        { userAttr: { ownerId: 'id', createdBy: 'id' } },
        ctx
      );

      expect(result.query).toEqual({
        ownerId: 'user-42',
        createdBy: 'user-42'
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should produce an empty query for an empty record', () => {
      expect(resolveConditions({ userAttr: {} }, ctx).query).toEqual({});
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should skip and warn when the attribute name is unknown', () => {
      const result = resolveConditions({ userAttr: { ownerId: 'email' } }, ctx);

      expect(result.query).toEqual({});
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('email'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ownerId'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('user-42'));
    });

    it('should skip and warn when the attribute name is not a string', () => {
      const result = resolveConditions(
        { userAttr: { ownerId: 123, createdBy: 'id' } },
        ctx
      );

      expect(result.query).toEqual({ createdBy: 'user-42' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ownerId'));
    });

    it('should skip and warn when the attribute name is null/undefined', () => {
      const result = resolveConditions(
        { userAttr: { a: null, b: undefined, c: 'id' } },
        ctx
      );

      expect(result.query).toEqual({ c: 'user-42' });
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('should mix valid and invalid attributes within the same record', () => {
      const result = resolveConditions(
        { userAttr: { ownerId: 'id', orgId: 'unknown' } },
        ctx
      );

      expect(result.query).toEqual({ ownerId: 'user-42' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('should not veto for any input', () => {
      expect(
        resolveConditions({ userAttr: { ownerId: 'id' } }, ctx).skipPermission
      ).toBe(false);
    });
  });

  describe('custom', () => {
    it('should parse and merge the JSON fragment (happy path)', () => {
      const result = resolveConditions(
        { custom: '{"status":{"$in":["active","pending"]}}' },
        ctx
      );

      expect(result.query).toEqual({ status: { $in: ['active', 'pending'] } });
      expect(result.skipPermission).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should contribute nothing for an empty JSON object', () => {
      expect(resolveConditions({ custom: '{}' }, ctx)).toEqual({
        query: {},
        skipPermission: false
      });
    });

    it('should skip (not veto) when JSON is malformed and warn', () => {
      const result = resolveConditions({ custom: '{not-valid-json' }, ctx);

      expect(result).toEqual({ query: {}, skipPermission: false });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid JSON')
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('user-1'));
    });

    it('should skip (not veto) when value is an empty string', () => {
      const result = resolveConditions({ custom: '' }, ctx);

      expect(result).toEqual({ query: {}, skipPermission: false });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid JSON')
      );
    });

    describe('denied MongoQuery operators', () => {
      it.each([
        ['$where', '{"$where":"function(){return true}"}'],
        ['$function', '{"$function":{"body":"x"}}'],
        ['$expr', '{"$expr":{"$gt":["$a","$b"]}}']
      ])('should veto the permission when %s is at top level', (op, json) => {
        const result = resolveConditions({ custom: json }, ctx);

        expect(result.skipPermission).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(op));
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('users:update')
        );
      });

      it('should veto when $where is nested inside $or', () => {
        const result = resolveConditions(
          { custom: '{"$or":[{"status":"active"},{"$where":"hack"}]}' },
          ctx
        );

        expect(result.skipPermission).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('$where'));
      });

      it('should veto when $expr is deeply nested inside $and', () => {
        const result = resolveConditions(
          { custom: '{"$and":[{"a":1},{"b":{"c":{"$expr":"x"}}}]}' },
          ctx
        );

        expect(result.skipPermission).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('$expr'));
      });
    });

    describe('prototype-pollution keys', () => {
      it.each([
        ['__proto__', '{"__proto__":{"admin":true}}'],
        ['constructor', '{"constructor":{"prototype":{"admin":true}}}'],
        ['prototype', '{"prototype":{"admin":true}}']
      ])('should veto when %s is at top level', (key, json) => {
        const result = resolveConditions({ custom: json }, ctx);

        expect(result.skipPermission).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(key));
      });

      it('should veto when __proto__ is nested inside another field', () => {
        const result = resolveConditions(
          {
            custom: '{"profile":{"settings":{"__proto__":{"role":"admin"}}}}'
          },
          ctx
        );

        expect(result.skipPermission).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('__proto__')
        );
      });

      it('should veto when constructor is nested inside an array element', () => {
        const result = resolveConditions(
          { custom: '{"$or":[{"a":1},{"constructor":{"x":1}}]}' },
          ctx
        );

        expect(result.skipPermission).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('constructor')
        );
      });
    });
  });

  describe('merge order', () => {
    it('should merge ownership, fieldMatch, userAttr and custom into one query', () => {
      const result = resolveConditions(
        {
          ownership: { userField: 'createdBy' },
          fieldMatch: { status: ['active'] },
          userAttr: { ownerId: 'id' },
          custom: '{"region":"eu"}'
        },
        ctx
      );

      expect(result).toEqual({
        query: {
          createdBy: 'user-1',
          status: { $in: ['active'] },
          ownerId: 'user-1',
          region: 'eu'
        },
        skipPermission: false
      });
    });

    it('should let a later branch overwrite an earlier branch on the same key', () => {
      // ownership writes `field` first; custom (last) overwrites it.
      const result = resolveConditions(
        {
          ownership: { userField: 'field' },
          custom: '{"field":"override"}'
        },
        ctx
      );

      expect(result.query).toEqual({ field: 'override' });
    });

    it('should veto and discard earlier merges when custom is unsafe', () => {
      const result = resolveConditions(
        {
          ownership: { userField: 'createdBy' },
          custom: '{"$where":"hack"}'
        },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('$where'));
    });
  });
});
