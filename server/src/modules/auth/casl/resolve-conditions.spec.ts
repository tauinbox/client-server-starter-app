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

    it('should veto an empty userField instead of producing a nonsense key', () => {
      const result = resolveConditions({ ownership: { userField: '' } }, ctx);

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('userField')
      );
    });

    it('should veto a non-string userField', () => {
      const result = resolveConditions(
        // @ts-expect-error testing invalid input shape stored before the DTO fix
        { ownership: { userField: 5 } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
    });

    it('should veto an empty ownership object', () => {
      const result = resolveConditions(
        // @ts-expect-error testing invalid input shape stored before the DTO fix
        { ownership: {} },
        ctx
      );

      expect(result.skipPermission).toBe(true);
    });

    it('should veto ownership carrying extra keys', () => {
      const result = resolveConditions(
        // @ts-expect-error testing invalid input shape stored before the DTO fix
        { ownership: { userField: 'createdBy', extra: 1 } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
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

    it('should veto for an empty record (fails closed, not an unconditional grant)', () => {
      const result = resolveConditions({ fieldMatch: {} }, ctx);

      expect(result.query).toEqual({});
      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('fieldMatch')
      );
    });

    it('should veto when every field value is an empty array', () => {
      const result = resolveConditions(
        { fieldMatch: { status: [], department: [] } },
        ctx
      );

      expect(result.query).toEqual({});
      expect(result.skipPermission).toBe(true);
    });

    it('should veto when one field value is an empty array (not silently narrow)', () => {
      const result = resolveConditions(
        { fieldMatch: { status: [], department: ['eng'] } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('status'));
    });

    it('should veto when one field value is not an array (the authored restriction must not vanish)', () => {
      const result = resolveConditions(
        // @ts-expect-error testing invalid input shape - non-array slipping past DTO
        { fieldMatch: { status: 'active', department: ['eng'] } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('status'));
    });

    it('should veto when a field value is null/undefined', () => {
      const result = resolveConditions(
        // @ts-expect-error testing invalid input shape
        { fieldMatch: { a: null, b: undefined, c: ['ok'] } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
    });

    it('should veto a prototype-pollution field key', () => {
      const result = resolveConditions(
        { fieldMatch: { ['__proto__']: ['x'] } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('__proto__')
      );
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

    it('should veto for an empty record (fails closed, not an unconditional grant)', () => {
      const result = resolveConditions({ userAttr: {} }, ctx);

      expect(result.query).toEqual({});
      expect(result.skipPermission).toBe(true);
    });

    it('should veto and warn when the only attribute name is unknown', () => {
      const result = resolveConditions({ userAttr: { ownerId: 'email' } }, ctx);

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('email'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ownerId'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('user-42'));
    });

    it('should veto when an attribute name is not a string (not silently narrow)', () => {
      const result = resolveConditions(
        { userAttr: { ownerId: 123, createdBy: 'id' } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ownerId'));
    });

    it('should veto when an attribute name is null/undefined', () => {
      const result = resolveConditions(
        { userAttr: { a: null, b: undefined, c: 'id' } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
    });

    it('should veto a mix of valid and unknown attributes (the unknown one must not vanish)', () => {
      const result = resolveConditions(
        { userAttr: { ownerId: 'id', orgId: 'unknown' } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown attribute')
      );
    });

    it('should veto a prototype-chain attribute name instead of resolving it', () => {
      const result = resolveConditions(
        { userAttr: { ownerId: 'constructor' } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(result.query).toEqual({});
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

    it('should veto for an empty JSON object (fails closed, not an unconditional grant)', () => {
      expect(resolveConditions({ custom: '{}' }, ctx)).toEqual({
        query: {},
        skipPermission: true
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('empty query')
      );
    });

    it('should veto when JSON is malformed and warn', () => {
      const result = resolveConditions({ custom: '{not-valid-json' }, ctx);

      expect(result).toEqual({ query: {}, skipPermission: true });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid JSON')
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('user-1'));
    });

    it('should veto when value is an empty string', () => {
      const result = resolveConditions({ custom: '' }, ctx);

      expect(result).toEqual({ query: {}, skipPermission: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid JSON')
      );
    });

    it('should veto malformed JSON even when another branch resolved (not silently narrow)', () => {
      const result = resolveConditions(
        {
          ownership: { userField: 'createdBy' },
          custom: '{not-valid-json'
        },
        ctx
      );

      expect(result.skipPermission).toBe(true);
    });

    it('should veto when the JSON parses to a non-object', () => {
      for (const custom of ['5', '"text"', '[1,2]', 'null']) {
        expect(resolveConditions({ custom }, ctx).skipPermission).toBe(true);
      }
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

    it('should veto when a custom key collides with ownership.userField (no row-scope widening)', () => {
      // A custom fragment like {"ownerId":{"$ne":null}} would replace the
      // owner binding with a broad predicate - must fail closed instead.
      const result = resolveConditions(
        {
          ownership: { userField: 'ownerId' },
          custom: '{"ownerId":{"$ne":null}}'
        },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('collides with ownership.userField')
      );
    });

    it('should veto when a fieldMatch key collides with ownership.userField', () => {
      const result = resolveConditions(
        {
          ownership: { userField: 'ownerId' },
          fieldMatch: { ownerId: ['a', 'b'] }
        },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('collides with ownership.userField')
      );
    });

    it('should veto when a userAttr key collides with ownership.userField', () => {
      const result = resolveConditions(
        {
          ownership: { userField: 'ownerId' },
          userAttr: { ownerId: 'id' }
        },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('collides with ownership.userField')
      );
    });

    it('should still let later branches overwrite each other on non-ownership keys', () => {
      // Only the ownership key is protected; fieldMatch -> custom keeps
      // documented later-wins semantics.
      const result = resolveConditions(
        {
          fieldMatch: { status: ['active'] },
          custom: '{"status":"archived"}'
        },
        ctx
      );

      expect(result.query).toEqual({ status: 'archived' });
      expect(result.skipPermission).toBe(false);
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

  describe('fail-closed partial resolution', () => {
    it('should veto a partially malformed fieldMatch instead of registering the narrower query', () => {
      // Admin forgot the array brackets on "dept" - the authored restriction
      // must not silently disappear, leaving only the status filter.
      const result = resolveConditions(
        // @ts-expect-error testing invalid input shape stored before the DTO fix
        { fieldMatch: { status: ['active'], dept: 'sales' } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dept'));
    });

    it('should veto a malformed branch even when another branch resolved a key', () => {
      const result = resolveConditions(
        {
          ownership: { userField: 'createdBy' },
          fieldMatch: { status: [] }
        },
        ctx
      );

      expect(result.skipPermission).toBe(true);
    });

    it('should not veto when a benign custom "{}" accompanies a resolving branch', () => {
      const result = resolveConditions(
        {
          ownership: { userField: 'createdBy' },
          custom: '{}'
        },
        ctx
      );

      expect(result).toEqual({
        query: { createdBy: 'user-1' },
        skipPermission: false
      });
    });

    it('should veto when all provided branches resolve to nothing', () => {
      const result = resolveConditions(
        {
          fieldMatch: { status: [] },
          userAttr: { ownerId: 'unknown' },
          custom: '{}'
        },
        ctx
      );

      expect(result.query).toEqual({});
      expect(result.skipPermission).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('users:update')
      );
    });

    it('should veto for a deny-effect condition whose branches resolve to nothing', () => {
      const result = resolveConditions(
        { effect: 'deny', fieldMatch: { status: [] } },
        ctx
      );

      expect(result.skipPermission).toBe(true);
    });
  });
});
