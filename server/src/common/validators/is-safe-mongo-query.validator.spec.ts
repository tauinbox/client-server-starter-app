import { IsSafeMongoQueryConstraint } from './is-safe-mongo-query.validator';

describe('IsSafeMongoQueryConstraint', () => {
  let validator: IsSafeMongoQueryConstraint;

  beforeEach(() => {
    validator = new IsSafeMongoQueryConstraint();
  });

  it('should accept null and undefined', () => {
    expect(validator.validate(null)).toBe(true);
    expect(validator.validate(undefined)).toBe(true);
  });

  it('should reject non-string values', () => {
    expect(validator.validate(123)).toBe(false);
    expect(validator.defaultMessage()).toContain('JSON string');
  });

  it('should reject invalid JSON', () => {
    expect(validator.validate('{bad')).toBe(false);
    expect(validator.defaultMessage()).toContain('valid JSON');
  });

  it('should reject non-object JSON (array)', () => {
    expect(validator.validate('[1,2]')).toBe(false);
    expect(validator.defaultMessage()).toContain('JSON object');
  });

  it('should reject non-object JSON (string)', () => {
    expect(validator.validate('"hello"')).toBe(false);
    expect(validator.defaultMessage()).toContain('JSON object');
  });

  it('should accept a simple field query', () => {
    expect(validator.validate('{"status":"active"}')).toBe(true);
  });

  it('should accept allowed operators', () => {
    const allowed = [
      '{"status":{"$eq":"active"}}',
      '{"count":{"$gt":5}}',
      '{"count":{"$gte":5}}',
      '{"count":{"$lt":10}}',
      '{"count":{"$lte":10}}',
      '{"status":{"$ne":"deleted"}}',
      '{"status":{"$in":["a","b"]}}',
      '{"status":{"$nin":["x"]}}',
      '{"$and":[{"a":1},{"b":2}]}',
      '{"$or":[{"a":1},{"b":2}]}',
      '{"$nor":[{"a":1}]}',
      '{"field":{"$not":{"$eq":"x"}}}',
      '{"field":{"$exists":true}}',
      '{"name":{"$regex":"^test","$options":"i"}}',
      '{"tags":{"$all":["a","b"]}}',
      '{"tags":{"$size":3}}',
      '{"count":{"$mod":[2,0]}}',
      '{"items":{"$elemMatch":{"price":{"$gt":5}}}}'
    ];

    for (const query of allowed) {
      expect(validator.validate(query)).toBe(true);
    }
  });

  it('should reject $where operator', () => {
    expect(validator.validate('{"$where":"function(){return true}"}')).toBe(
      false
    );
    expect(validator.defaultMessage()).toContain('$where');
    expect(validator.defaultMessage()).toContain('not allowed');
  });

  it('should reject $function operator', () => {
    expect(validator.validate('{"$function":{"body":"return 1"}}')).toBe(false);
    expect(validator.defaultMessage()).toContain('$function');
  });

  it('should reject $expr operator', () => {
    expect(validator.validate('{"$expr":{"$gt":["$a","$b"]}}')).toBe(false);
    expect(validator.defaultMessage()).toContain('$expr');
  });

  it('should reject $where nested inside $and', () => {
    expect(validator.validate('{"$and":[{"$where":"return true"}]}')).toBe(
      false
    );
    expect(validator.defaultMessage()).toContain('$where');
  });

  it('should reject $where deeply nested', () => {
    const deep =
      '{"$or":[{"$and":[{"field":{"$elemMatch":{"$where":"hack"}}}]}]}';
    expect(validator.validate(deep)).toBe(false);
    expect(validator.defaultMessage()).toContain('$where');
  });

  it('should reject unknown operators', () => {
    expect(validator.validate('{"field":{"$text":"search"}}')).toBe(false);
    expect(validator.defaultMessage()).toContain('Unknown operator');
    expect(validator.defaultMessage()).toContain('$text');
  });

  it('should reject prototype pollution keys', () => {
    expect(validator.validate('{"__proto__":{"admin":true}}')).toBe(false);
    expect(validator.defaultMessage()).toContain('Prototype pollution');

    expect(validator.validate('{"constructor":{"admin":true}}')).toBe(false);
    expect(validator.validate('{"prototype":{"admin":true}}')).toBe(false);
  });

  it('should reject prototype pollution keys nested inside operators', () => {
    expect(validator.validate('{"$and":[{"__proto__":{"admin":true}}]}')).toBe(
      false
    );
  });

  it('should accept an empty object', () => {
    expect(validator.validate('{}')).toBe(true);
  });
});
