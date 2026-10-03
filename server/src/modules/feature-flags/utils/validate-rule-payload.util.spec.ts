import { BadRequestException } from '@nestjs/common';
import {
  FEATURE_FLAG_ATTRIBUTE_FIELD_OPS,
  FEATURE_FLAG_ATTRIBUTE_FIELDS,
  FEATURE_FLAG_ATTRIBUTE_OPS,
  FEATURE_FLAG_BUCKET_BY,
  FEATURE_FLAG_PREVIEW_REASONS,
  FEATURE_FLAG_RULE_EFFECTS,
  FEATURE_FLAG_RULE_TYPES
} from '@app/shared/constants';
import {
  ATTRIBUTE_VALUE_MAX_ITEMS,
  ATTRIBUTE_VALUE_MAX_LENGTH
} from '@app/shared/utils/feature-flag-attribute-value';
import { validateRulePayload } from './validate-rule-payload.util';

describe('validateRulePayload user and role lists', () => {
  const noCustomKeys = new Set<string>();
  const userIdsMessage =
    'user rule requires userIds: an array of up to 100 UUIDs';
  const roleNamesMessage =
    'role rule requires roleNames: an array of up to 32 names of 1-100 characters';
  const uuid = (i: number): string =>
    `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

  it('accepts 100 UUIDs', () => {
    const userIds = Array.from({ length: 100 }, (_, i) => uuid(i));
    expect(
      validateRulePayload('user', { type: 'user', userIds }, noCustomKeys)
    ).toEqual({ type: 'user', userIds });
  });

  it.each([
    ['a non-UUID', ['not-a-uuid']],
    ['an empty string', ['']],
    ['a param-only UUID', ['11111111-1111-1111-1111-111111111111']],
    ['101 items', Array.from({ length: 101 }, (_, i) => uuid(i))]
  ])('rejects userIds with %s', (_label, userIds) => {
    expect(() =>
      validateRulePayload('user', { type: 'user', userIds }, noCustomKeys)
    ).toThrow(userIdsMessage);
  });

  it('accepts 32 role names of 100 characters', () => {
    const roleNames = Array.from({ length: 32 }, (_, i) =>
      String(i).padEnd(100, 'x')
    );
    expect(
      validateRulePayload('role', { type: 'role', roleNames }, noCustomKeys)
    ).toEqual({ type: 'role', roleNames });
  });

  it.each([
    ['an empty name', ['']],
    ['a name of 101 characters', ['x'.repeat(101)]],
    ['33 items', Array.from({ length: 33 }, (_, i) => `role-${i}`)]
  ])('rejects roleNames with %s', (_label, roleNames) => {
    expect(() =>
      validateRulePayload('role', { type: 'role', roleNames }, noCustomKeys)
    ).toThrow(roleNamesMessage);
  });
});

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

  it('pins the percentage bucketBy values', () => {
    expect(FEATURE_FLAG_BUCKET_BY).toEqual(['user', 'device']);
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

  it('pins the operators each attribute field supports', () => {
    expect(FEATURE_FLAG_ATTRIBUTE_FIELD_OPS).toEqual({
      email: ['eq', 'in', 'endsWith'],
      emailDomain: ['eq', 'in', 'endsWith'],
      createdAt: ['before', 'after'],
      custom: ['eq', 'in', 'endsWith', 'before', 'after']
    });
  });

  it('pins the preview reasons', () => {
    expect(FEATURE_FLAG_PREVIEW_REASONS).toEqual([
      'disabled',
      'env-mismatch',
      'excluded',
      'included-by-rule',
      'no-rules-default-on',
      'not-included'
    ]);
  });
});

describe('validateRulePayload attribute value', () => {
  const knownCustomKeys = new Set<string>(['oauth.google.configured']);

  function validate(op: string, value: unknown): unknown {
    const field = op === 'before' || op === 'after' ? 'createdAt' : 'email';
    return validateRulePayload(
      'attribute',
      { type: 'attribute', field, op, value },
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

  describe('field and operator pair', () => {
    it.each([
      ['createdAt', 'eq', '2026-01-01T00:00:00Z'],
      ['createdAt', 'in', ['2026-01-01T00:00:00Z']],
      ['createdAt', 'endsWith', 'Z'],
      ['email', 'before', '2026-01-01T00:00:00Z'],
      ['emailDomain', 'after', '2026-01-01T00:00:00Z']
    ])('rejects field=%s with op=%s', (field, op, value) => {
      expect(() =>
        validateRulePayload(
          'attribute',
          { type: 'attribute', field, op, value },
          knownCustomKeys
        )
      ).toThrow(`attribute rule with field=${field} does not support op=${op}`);
    });

    it.each(['eq', 'in', 'endsWith', 'before', 'after'])(
      'accepts a custom key with op=%s',
      (op) => {
        const value =
          op === 'in'
            ? [true]
            : op === 'before' || op === 'after'
              ? '2026-01-01T00:00:00Z'
              : 'x';
        expect(
          validateRulePayload(
            'attribute',
            {
              type: 'attribute',
              field: 'custom',
              customKey: 'oauth.google.configured',
              op,
              value
            },
            knownCustomKeys
          )
        ).toMatchObject({ field: 'custom', op });
      }
    );
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

  it.each(['user', 'device'])('keeps percentage bucketBy=%s', (bucketBy) => {
    expect(
      validateRulePayload(
        'percentage',
        { type: 'percentage', percent: 25, bucketBy },
        knownCustomKeys
      )
    ).toEqual({ type: 'percentage', percent: 25, bucketBy });
  });

  it('rejects an unregistered customKey with the registry message', () => {
    expect(() =>
      validateRulePayload(
        'attribute',
        {
          type: 'attribute',
          field: 'custom',
          customKey: 'nope',
          op: 'eq',
          value: true
        },
        knownCustomKeys
      )
    ).toThrow('customKey "nope" is not registered in the attribute registry');
  });

  it('rejects an out-of-range percent with the range message', () => {
    expect(() =>
      validateRulePayload(
        'percentage',
        { type: 'percentage', percent: 500 },
        knownCustomKeys
      )
    ).toThrow('percentage rule requires percent: an integer in [0, 100]');
  });

  it('rejects a fractional percent, which the integer bucket rounds up', () => {
    expect(() =>
      validateRulePayload(
        'percentage',
        { type: 'percentage', percent: 0.5 },
        knownCustomKeys
      )
    ).toThrow('percentage rule requires percent: an integer in [0, 100]');
  });

  it.each(['session', null, 1])(
    'rejects percentage bucketBy=%p',
    (bucketBy) => {
      expect(() =>
        validateRulePayload(
          'percentage',
          { type: 'percentage', percent: 25, bucketBy },
          knownCustomKeys
        )
      ).toThrow(BadRequestException);
    }
  );
});
