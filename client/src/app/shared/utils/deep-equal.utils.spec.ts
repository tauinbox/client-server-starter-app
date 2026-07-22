import { deepEqual } from './deep-equal.utils';

describe('deepEqual', () => {
  it('compares primitives by value', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('ignores object key order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(
      deepEqual(
        { type: 'attribute', field: 'emailDomain', value: '@acme.com' },
        { value: '@acme.com', type: 'attribute', field: 'emailDomain' }
      )
    ).toBe(true);
  });

  it('reports differing values, extra keys and missing keys', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('treats a key holding undefined as absent', () => {
    expect(deepEqual({ a: 1, customKey: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, customKey: undefined })).toBe(true);
    expect(deepEqual({ a: 1, customKey: 'x' }, { a: 1 })).toBe(false);
  });

  it('recurses into nested objects and arrays', () => {
    expect(
      deepEqual({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 2 }] } })
    ).toBe(true);
    expect(
      deepEqual({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 3 }] } })
    ).toBe(false);
  });

  it('keeps array order and length significant', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
  });

  it('does not confuse an array with an object', () => {
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual({ 0: 'a' }, ['a'])).toBe(false);
  });

  it('compares non-plain objects by reference only', () => {
    const date = new Date('2026-05-19T10:00:00Z');
    expect(deepEqual(date, date)).toBe(true);
    expect(deepEqual(date, new Date('2026-05-19T10:00:00Z'))).toBe(false);
  });
});
