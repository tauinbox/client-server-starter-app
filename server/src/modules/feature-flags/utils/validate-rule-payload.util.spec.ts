import { BadRequestException } from '@nestjs/common';
import {
  FEATURE_FLAG_ATTRIBUTE_FIELDS,
  FEATURE_FLAG_ATTRIBUTE_OPS,
  FEATURE_FLAG_RULE_EFFECTS,
  FEATURE_FLAG_RULE_TYPES
} from '@app/shared/constants';
import {
  ATTRIBUTE_VALUE_MAX_ITEMS,
  ATTRIBUTE_VALUE_MAX_LENGTH
} from '@app/shared/utils/feature-flag-attribute-value';
import { validateRulePayload } from './validate-rule-payload.util';

// The unions are derived from these arrays, so dropping a member no longer
// fails to compile anywhere - it silently narrows the type in all three
// workspaces at once. These lists are a wire contract with every stored rule,
// so they are pinned here rather than left to the type system.
describe('feature-flag rule vocabulary', () => {
  it('pins the rule types', () => {
    expect(FEATURE_FLAG_RULE_TYPES).toEqual([
      'user',
      'role',
      'percentage',
      'attribute'
    ]);
  });

  it('pins the rule effects', () => {
    expect(FEATURE_FLAG_RULE_EFFECTS).toEqual(['include', 'exclude']);
  });

  it('pins the attribute fields', () => {
    expect(FEATURE_FLAG_ATTRIBUTE_FIELDS).toEqual([
      'email',
      'emailDomain',
      'createdAt',
      'custom'
    ]);
  });

  it('pins the attribute operators', () => {
    expect(FEATURE_FLAG_ATTRIBUTE_OPS).toEqual([
      'eq',
      'in',
      'endsWith',
      'before',
      'after'
    ]);
  });
});

describe('validateRulePayload attribute value', () => {
  const knownCustomKeys = new Set<string>(['oauth.google.configured']);

  function validate(op: string, value: unknown): unknown {
    return validateRulePayload(
      'attribute',
      { type: 'attribute', field: 'email', op, value },
      knownCustomKeys
    );
  }

  function expectRejected(op: string, value: unknown): void {
    expect(() => validate(op, value)).toThrow(BadRequestException);
  }

  describe('eq', () => {
    it.each([['a@b.com'], [42], [true], [null]])(
      'accepts the scalar %p',
      (value) => {
        expect(validate('eq', value)).toMatchObject({ op: 'eq', value });
      }
    );

    it('rejects an object, which the evaluator can never match', () => {
      expectRejected('eq', { nested: true });
    });

    it('rejects a string over the size cap', () => {
      expectRejected('eq', 'x'.repeat(ATTRIBUTE_VALUE_MAX_LENGTH + 1));
    });
  });

  describe('in', () => {
    it('accepts a non-empty scalar array', () => {
      expect(validate('in', ['a', 'b'])).toMatchObject({
        value: ['a', 'b']
      });
    });

    it('rejects a non-array', () => {
      expectRejected('in', 'a');
    });

    it('rejects an empty array, which can never match', () => {
      expectRejected('in', []);
    });

    it('rejects more items than the cap', () => {
      expectRejected(
        'in',
        Array.from({ length: ATTRIBUTE_VALUE_MAX_ITEMS + 1 }, (_, i) => i)
      );
    });

    it('rejects an array containing an object', () => {
      expectRejected('in', ['a', { nested: true }]);
    });
  });

  describe('endsWith', () => {
    it('accepts a non-empty string', () => {
      expect(validate('endsWith', '@example.com')).toMatchObject({
        value: '@example.com'
      });
    });

    it('rejects a non-string', () => {
      expectRejected('endsWith', 42);
    });

    it('rejects an empty string, which matches every value', () => {
      expectRejected('endsWith', '');
    });
  });

  describe.each(['before', 'after'])('%s', (op) => {
    it('accepts an ISO date string', () => {
      expect(validate(op, '2026-01-01T00:00:00Z')).toMatchObject({ op });
    });

    it('accepts an epoch-millisecond number', () => {
      expect(validate(op, 1767225600000)).toMatchObject({ op });
    });

    it('rejects an unparseable string', () => {
      expectRejected(op, 'not-a-date');
    });

    it('rejects a boolean', () => {
      expectRejected(op, true);
    });
  });

  it('still validates the other rule types unchanged', () => {
    expect(
      validateRulePayload(
        'percentage',
        { type: 'percentage', percent: 25 },
        knownCustomKeys
      )
    ).toEqual({ type: 'percentage', percent: 25 });
  });
});
