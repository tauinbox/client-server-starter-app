import {
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

describe('mongo-query-safety list operator elements', () => {
  it('accepts an $in array of JSON scalars', () => {
    expect(
      validateMongoQueryKeys({ id: { $in: ['u-1', 3, true, null] } })
    ).toBeNull();
  });

  it('rejects an $in array holding an object', () => {
    expect(validateMongoQueryKeys({ id: { $in: ['u-1', {}] } })).toContain(
      'Operator "$in" at id.$in must be an array of'
    );
  });

  it('rejects a $nin array holding a nested array', () => {
    expect(validateMongoQueryKeys({ email: { $nin: [['a@x.io']] } })).toContain(
      'Operator "$nin" at email.$nin must be an array of'
    );
  });

  it('rejects a list operator whose value is not an array', () => {
    expect(validateMongoQueryKeys({ id: { $in: 'u-1' } })).toContain(
      'Operator "$in" at id.$in must be an array'
    );
  });

  it('rejects a non-scalar element nested under a logical operator', () => {
    expect(
      validateMongoQueryKeys({ $or: [{ id: { $in: [{ nested: 'x' }] } }] })
    ).toContain('must be an array of');
  });
});
