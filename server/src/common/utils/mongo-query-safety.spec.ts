import {
  findDeniedMongoKey,
  MAX_MONGO_QUERY_DEPTH,
  validateMongoQueryKeys
} from '@app/shared/utils/mongo-query-safety';

function nest(depth: number): Record<string, unknown> {
  let obj: Record<string, unknown> = {};
  for (let i = 0; i < depth; i++) {
    obj = { a: obj };
  }
  return obj;
}

describe('mongo-query-safety depth limit', () => {
  const pastLimit = nest(MAX_MONGO_QUERY_DEPTH + 5);
  // Deep enough to overflow the call stack without the depth guard.
  const stackBreaker = nest(200_000);

  describe('findDeniedMongoKey', () => {
    it('accepts nesting up to the limit', () => {
      expect(findDeniedMongoKey(nest(MAX_MONGO_QUERY_DEPTH - 1))).toBeNull();
    });

    it('fails closed just past the limit', () => {
      expect(findDeniedMongoKey(nest(MAX_MONGO_QUERY_DEPTH))).toContain(
        'nesting deeper than'
      );
      expect(findDeniedMongoKey(pastLimit)).toContain('nesting deeper than');
    });

    it('does not throw on pathologically deep input', () => {
      expect(() => findDeniedMongoKey(stackBreaker)).not.toThrow();
      expect(findDeniedMongoKey(stackBreaker)).not.toBeNull();
    });

    it('still finds a denied operator within the limit', () => {
      expect(findDeniedMongoKey({ a: { $where: 'x' } })).toBe('$where');
    });
  });

  describe('validateMongoQueryKeys', () => {
    it('accepts nesting up to the limit', () => {
      expect(
        validateMongoQueryKeys(nest(MAX_MONGO_QUERY_DEPTH - 1))
      ).toBeNull();
    });

    it('fails closed just past the limit', () => {
      expect(validateMongoQueryKeys(nest(MAX_MONGO_QUERY_DEPTH))).toContain(
        'Nesting deeper than'
      );
      expect(validateMongoQueryKeys(pastLimit)).toContain(
        'Nesting deeper than'
      );
    });

    it('does not throw on pathologically deep input', () => {
      expect(() => validateMongoQueryKeys(stackBreaker)).not.toThrow();
      expect(validateMongoQueryKeys(stackBreaker)).not.toBeNull();
    });

    it('still rejects an unknown operator within the limit', () => {
      expect(validateMongoQueryKeys({ a: { $regex: 'x' } })).toContain(
        'Unknown operator "$regex"'
      );
    });
  });
});
