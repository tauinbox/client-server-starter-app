import { featureFlagRuleError } from './feature-flag-rule-validation';

describe('featureFlagRuleError', () => {
  it('accepts the non-attribute rule types', () => {
    expect(featureFlagRuleError({ type: 'user', userIds: [] })).toBeNull();
    expect(featureFlagRuleError({ type: 'role', roleNames: [] })).toBeNull();
    expect(featureFlagRuleError({ type: 'percentage', percent: 0 })).toBeNull();
  });

  it('reports a date operator that has no date yet', () => {
    expect(
      featureFlagRuleError({
        type: 'attribute',
        field: 'createdAt',
        op: 'before',
        value: ''
      })
    ).toBe('admin.featureFlagRule.errorValueDate');
  });

  it('reports an empty custom key', () => {
    expect(
      featureFlagRuleError({
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: 'gold',
        customKey: '   '
      })
    ).toBe('admin.featureFlagRule.errorCustomKeyRequired');
  });

  it('reports an empty `in` list', () => {
    expect(
      featureFlagRuleError({
        type: 'attribute',
        field: 'email',
        op: 'in',
        value: []
      })
    ).toBe('admin.featureFlagRule.errorValueListRequired');
  });

  it('reports an empty endsWith value', () => {
    expect(
      featureFlagRuleError({
        type: 'attribute',
        field: 'emailDomain',
        op: 'endsWith',
        value: ''
      })
    ).toBe('admin.featureFlagRule.errorValueRequired');
  });

  it('accepts every scalar the server accepts for eq, including an empty string', () => {
    for (const value of ['', 'gold', 42, true, null]) {
      expect(
        featureFlagRuleError({
          type: 'attribute',
          field: 'custom',
          op: 'eq',
          value,
          customKey: 'plan'
        })
      ).toBeNull();
    }
  });

  it('reports a custom key the server has not registered', () => {
    expect(
      featureFlagRuleError(
        {
          type: 'attribute',
          field: 'custom',
          op: 'eq',
          value: 'gold',
          customKey: 'plan'
        },
        new Set(['billingConfigured'])
      )
    ).toBe('admin.featureFlagRule.errorCustomKeyUnknown');
  });

  it('accepts a registered custom key', () => {
    expect(
      featureFlagRuleError(
        {
          type: 'attribute',
          field: 'custom',
          op: 'eq',
          value: 'gold',
          customKey: 'billingConfigured'
        },
        new Set(['billingConfigured'])
      )
    ).toBeNull();
  });

  it('matches the key verbatim, as the server does', () => {
    expect(
      featureFlagRuleError(
        {
          type: 'attribute',
          field: 'custom',
          op: 'eq',
          value: 'gold',
          customKey: ' billingConfigured '
        },
        new Set(['billingConfigured'])
      )
    ).toBe('admin.featureFlagRule.errorCustomKeyUnknown');
  });

  it('skips the membership check when the catalog is unknown', () => {
    expect(
      featureFlagRuleError({
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: 'gold',
        customKey: 'plan'
      })
    ).toBeNull();
  });

  it('reports an empty key before the membership check', () => {
    expect(
      featureFlagRuleError(
        {
          type: 'attribute',
          field: 'custom',
          op: 'eq',
          value: 'gold',
          customKey: ''
        },
        new Set(['billingConfigured'])
      )
    ).toBe('admin.featureFlagRule.errorCustomKeyRequired');
  });

  it('accepts a filled date operator', () => {
    expect(
      featureFlagRuleError({
        type: 'attribute',
        field: 'createdAt',
        op: 'after',
        value: '2026-01-15T00:00:00.000Z'
      })
    ).toBeNull();
  });
});
