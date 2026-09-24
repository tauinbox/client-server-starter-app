import {
  anonymousEvaluationNeedsAnonId,
  evaluateFeatureFlag,
  percentageBucket,
  previewFeatureFlag,
  signedInEvaluationNeedsAnonId
} from '@app/shared/utils/feature-flag-evaluator';
import type {
  AnonymousEvaluatorFlag,
  EvaluatorFlag,
  EvaluatorRule,
  FeatureFlagEvaluationContext,
  RolloutEvaluatorFlag
} from '@app/shared/utils/feature-flag-evaluator';

const baseFlag = (overrides: Partial<EvaluatorFlag> = {}): EvaluatorFlag => ({
  key: 'demo-flag',
  enabled: true,
  environments: [],
  ...overrides
});

const baseCtx = (
  overrides: Partial<FeatureFlagEvaluationContext> = {}
): FeatureFlagEvaluationContext => ({
  userId: 'user-1',
  anonId: null,
  roles: [],
  attributes: {},
  env: 'production',
  ...overrides
});

const rule = (
  effect: 'include' | 'exclude',
  payload: EvaluatorRule['payload']
): EvaluatorRule => ({ effect, payload });

describe('evaluateFeatureFlag — short-circuits', () => {
  it('returns false when flag.enabled is false', () => {
    expect(
      evaluateFeatureFlag(baseFlag({ enabled: false }), [], baseCtx())
    ).toBe(false);
  });

  it('returns false when environments is non-empty and env does not match', () => {
    const flag = baseFlag({ environments: ['production', 'staging'] });
    expect(evaluateFeatureFlag(flag, [], baseCtx({ env: 'development' }))).toBe(
      false
    );
  });

  it('returns true when environments is non-empty and env matches', () => {
    const flag = baseFlag({ environments: ['production'] });
    expect(evaluateFeatureFlag(flag, [], baseCtx({ env: 'production' }))).toBe(
      true
    );
  });

  it('returns true when no rules and enabled (unconstrained include)', () => {
    expect(evaluateFeatureFlag(baseFlag(), [], baseCtx())).toBe(true);
  });
});

describe('evaluateFeatureFlag — rule types', () => {
  it('user include rule matches the listed user id', () => {
    const rules = [
      rule('include', { type: 'user', userIds: ['alice', 'bob'] })
    ];
    expect(
      evaluateFeatureFlag(baseFlag(), rules, baseCtx({ userId: 'alice' }))
    ).toBe(true);
    expect(
      evaluateFeatureFlag(baseFlag(), rules, baseCtx({ userId: 'carol' }))
    ).toBe(false);
  });

  it('user rule does not match for guest (userId null)', () => {
    const rules = [rule('include', { type: 'user', userIds: ['alice'] })];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ userId: null, anonId: 'anon-1' })
      )
    ).toBe(false);
  });

  it('role rule matches when any role overlaps', () => {
    const rules = [
      rule('include', { type: 'role', roleNames: ['admin', 'editor'] })
    ];
    expect(
      evaluateFeatureFlag(baseFlag(), rules, baseCtx({ roles: ['editor'] }))
    ).toBe(true);
    expect(
      evaluateFeatureFlag(baseFlag(), rules, baseCtx({ roles: ['viewer'] }))
    ).toBe(false);
    expect(evaluateFeatureFlag(baseFlag(), rules, baseCtx({ roles: [] }))).toBe(
      false
    );
  });

  it('percentage rule at 100 always matches; at 0 never matches', () => {
    const all = [rule('include', { type: 'percentage', percent: 100 })];
    const none = [rule('include', { type: 'percentage', percent: 0 })];
    const ctx = baseCtx({ userId: 'x' });
    expect(evaluateFeatureFlag(baseFlag(), all, ctx)).toBe(true);
    expect(evaluateFeatureFlag(baseFlag(), none, ctx)).toBe(false);
  });

  it('percentage rule uses anonId when userId is null', () => {
    const rules = [rule('include', { type: 'percentage', percent: 100 })];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ userId: null, anonId: 'anon-42' })
      )
    ).toBe(true);
  });

  it('percentage rule does not match when both ids are null', () => {
    const rules = [rule('include', { type: 'percentage', percent: 100 })];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ userId: null, anonId: null })
      )
    ).toBe(false);
  });

  describe('percentage bucketBy', () => {
    // Ids on opposite sides of a 50 % split for `demo-flag`.
    const idIn = pickId((b) => b < 50);
    const idOut = pickId((b) => b >= 50);
    const half = (bucketBy?: 'user' | 'device') => [
      rule('include', {
        type: 'percentage',
        percent: 50,
        ...(bucketBy ? { bucketBy } : {})
      })
    ];

    function pickId(fits: (bucket: number) => boolean): string {
      for (let i = 0; ; i++) {
        if (fits(percentageBucket(`id-${i}`, 'demo-flag'))) return `id-${i}`;
      }
    }

    it('device keys on anonId and ignores userId', () => {
      const ctx = baseCtx({ userId: idOut, anonId: idIn });
      expect(evaluateFeatureFlag(baseFlag(), half('device'), ctx)).toBe(true);
    });

    it('device does not match without an anonId, even for a user', () => {
      const all = [
        rule('include', {
          type: 'percentage',
          percent: 100,
          bucketBy: 'device'
        })
      ];
      expect(
        evaluateFeatureFlag(baseFlag(), all, baseCtx({ anonId: null }))
      ).toBe(false);
    });

    it('user keys on userId before anonId', () => {
      const ctx = baseCtx({ userId: idOut, anonId: idIn });
      expect(evaluateFeatureFlag(baseFlag(), half('user'), ctx)).toBe(false);
    });

    it('an absent bucketBy behaves as user', () => {
      for (const ctx of [
        baseCtx({ userId: idOut, anonId: idIn }),
        baseCtx({ userId: idIn, anonId: idOut }),
        baseCtx({ userId: null, anonId: idIn })
      ]) {
        expect(evaluateFeatureFlag(baseFlag(), half(), ctx)).toBe(
          evaluateFeatureFlag(baseFlag(), half('user'), ctx)
        );
      }
    });
  });

  it('attribute rule eq op matches when attribute equals expected', () => {
    const rules = [
      rule('include', {
        type: 'attribute',
        field: 'email',
        op: 'eq',
        value: 'a@b.com'
      })
    ];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { email: 'a@b.com' } })
      )
    ).toBe(true);
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { email: 'x@y.com' } })
      )
    ).toBe(false);
  });

  it('attribute rule in op matches when value array includes attribute', () => {
    const rules = [
      rule('include', {
        type: 'attribute',
        field: 'emailDomain',
        op: 'in',
        value: ['example.com', 'acme.org']
      })
    ];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { emailDomain: 'acme.org' } })
      )
    ).toBe(true);
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { emailDomain: 'other.io' } })
      )
    ).toBe(false);
  });

  it('attribute rule in op rejects non-array expected', () => {
    const rules = [
      rule('include', {
        type: 'attribute',
        field: 'emailDomain',
        op: 'in',
        value: 'example.com'
      })
    ];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { emailDomain: 'example.com' } })
      )
    ).toBe(false);
  });

  it('attribute rule endsWith matches when both sides are strings', () => {
    const rules = [
      rule('include', {
        type: 'attribute',
        field: 'email',
        op: 'endsWith',
        value: '@acme.org'
      })
    ];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { email: 'bob@acme.org' } })
      )
    ).toBe(true);
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { email: 'bob@example.com' } })
      )
    ).toBe(false);
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { email: 42 } })
      )
    ).toBe(false);
  });

  it('attribute rule before/after compare timestamps from Date, string, and number', () => {
    const rules = [
      rule('include', {
        type: 'attribute',
        field: 'createdAt',
        op: 'after',
        value: '2025-01-01T00:00:00Z'
      })
    ];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { createdAt: '2025-06-01T00:00:00Z' } })
      )
    ).toBe(true);
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { createdAt: new Date('2024-12-31') } })
      )
    ).toBe(false);

    const before = [
      rule('include', {
        type: 'attribute',
        field: 'createdAt',
        op: 'before',
        value: Date.parse('2025-01-01T00:00:00Z')
      })
    ];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        before,
        baseCtx({ attributes: { createdAt: '2024-06-01T00:00:00Z' } })
      )
    ).toBe(true);
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        before,
        baseCtx({ attributes: { createdAt: 'not-a-date' } })
      )
    ).toBe(false);
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        before,
        baseCtx({ attributes: { createdAt: Number.NaN } })
      )
    ).toBe(false);
  });

  it('attribute rule with field=custom reads from attributes[customKey]', () => {
    const rules = [
      rule('include', {
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: 'gold',
        customKey: 'tier'
      })
    ];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { tier: 'gold' } })
      )
    ).toBe(true);
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ attributes: { tier: 'silver' } })
      )
    ).toBe(false);
  });

  it('attribute rule with field=custom and missing customKey is a no-match', () => {
    const rules = [
      rule('include', {
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: 'x'
      })
    ];
    expect(evaluateFeatureFlag(baseFlag(), rules, baseCtx())).toBe(false);
  });
});

describe('evaluateFeatureFlag — composition', () => {
  it('deny-overrides: exclude wins even when include matches', () => {
    const rules = [
      rule('include', { type: 'user', userIds: ['alice'] }),
      rule('exclude', { type: 'role', roleNames: ['banned'] })
    ];
    const ctx = baseCtx({ userId: 'alice', roles: ['banned'] });
    expect(evaluateFeatureFlag(baseFlag(), rules, ctx)).toBe(false);
  });

  it('returns true when only excludes are present and none match', () => {
    const rules = [rule('exclude', { type: 'role', roleNames: ['banned'] })];
    expect(
      evaluateFeatureFlag(baseFlag(), rules, baseCtx({ roles: ['member'] }))
    ).toBe(true);
  });

  it('returns false when includes exist but none match', () => {
    const rules = [rule('include', { type: 'user', userIds: ['alice'] })];
    expect(
      evaluateFeatureFlag(baseFlag(), rules, baseCtx({ userId: 'carol' }))
    ).toBe(false);
  });

  it('includes are OR — any matching rule wins', () => {
    const rules = [
      rule('include', { type: 'user', userIds: ['alice'] }),
      rule('include', { type: 'role', roleNames: ['admin'] })
    ];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rules,
        baseCtx({ userId: 'bob', roles: ['admin'] })
      )
    ).toBe(true);
  });

  it('excludes always win over includes regardless of array order', () => {
    const rulesIncludeFirst = [
      rule('include', { type: 'user', userIds: ['alice'] }),
      rule('exclude', { type: 'user', userIds: ['alice'] })
    ];
    const rulesExcludeFirst = [
      rule('exclude', { type: 'user', userIds: ['alice'] }),
      rule('include', { type: 'user', userIds: ['alice'] })
    ];
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rulesIncludeFirst,
        baseCtx({ userId: 'alice' })
      )
    ).toBe(false);
    expect(
      evaluateFeatureFlag(
        baseFlag(),
        rulesExcludeFirst,
        baseCtx({ userId: 'alice' })
      )
    ).toBe(false);
  });
});

describe('previewFeatureFlag — reasons', () => {
  it('reason "disabled" when flag.enabled is false', () => {
    const result = previewFeatureFlag(
      baseFlag({ enabled: false }),
      [],
      baseCtx()
    );
    expect(result).toEqual({
      result: false,
      reason: 'disabled',
      matchedRule: null
    });
  });

  it('reason "env-mismatch" when environments is non-empty and env does not match', () => {
    const flag = baseFlag({ environments: ['production'] });
    const result = previewFeatureFlag(flag, [], baseCtx({ env: 'staging' }));
    expect(result).toEqual({
      result: false,
      reason: 'env-mismatch',
      matchedRule: null
    });
  });

  it('reason "no-rules-default-on" when enabled and no include rules', () => {
    expect(previewFeatureFlag(baseFlag(), [], baseCtx())).toEqual({
      result: true,
      reason: 'no-rules-default-on',
      matchedRule: null
    });
    const onlyExcludes = [
      rule('exclude', { type: 'role', roleNames: ['banned'] })
    ];
    expect(
      previewFeatureFlag(baseFlag(), onlyExcludes, baseCtx({ roles: ['ok'] }))
    ).toEqual({
      result: true,
      reason: 'no-rules-default-on',
      matchedRule: null
    });
  });

  it('reason "excluded" with matchedRule when an exclude rule fires (user)', () => {
    const rules = [
      rule('include', { type: 'percentage', percent: 100 }),
      rule('exclude', { type: 'user', userIds: ['alice'] })
    ];
    const result = previewFeatureFlag(
      baseFlag(),
      rules,
      baseCtx({ userId: 'alice' })
    );
    expect(result).toEqual({
      result: false,
      reason: 'excluded',
      matchedRule: { index: 1, type: 'user', effect: 'exclude' }
    });
  });

  it('reason "excluded" with matchedRule when an exclude rule fires (role)', () => {
    const rules = [
      rule('include', { type: 'role', roleNames: ['beta'] }),
      rule('exclude', { type: 'role', roleNames: ['banned'] })
    ];
    const result = previewFeatureFlag(
      baseFlag(),
      rules,
      baseCtx({ roles: ['beta', 'banned'] })
    );
    expect(result.result).toBe(false);
    expect(result.reason).toBe('excluded');
    expect(result.matchedRule).toEqual({
      index: 1,
      type: 'role',
      effect: 'exclude'
    });
  });

  it('reason "excluded" with matchedRule when an exclude rule fires (attribute)', () => {
    const rules = [
      rule('exclude', {
        type: 'attribute',
        field: 'email',
        op: 'endsWith',
        value: '@contractor.com'
      })
    ];
    const result = previewFeatureFlag(
      baseFlag(),
      rules,
      baseCtx({ attributes: { email: 'bob@contractor.com' } })
    );
    expect(result).toEqual({
      result: false,
      reason: 'excluded',
      matchedRule: { index: 0, type: 'attribute', effect: 'exclude' }
    });
  });

  it('reason "excluded" with matchedRule when an exclude rule fires (percentage)', () => {
    const rules = [rule('exclude', { type: 'percentage', percent: 100 })];
    const result = previewFeatureFlag(
      baseFlag(),
      rules,
      baseCtx({ userId: 'x' })
    );
    expect(result).toEqual({
      result: false,
      reason: 'excluded',
      matchedRule: { index: 0, type: 'percentage', effect: 'exclude' }
    });
  });

  it('reason "included-by-rule" with matchedRule when an include rule fires', () => {
    const rules = [
      rule('include', { type: 'role', roleNames: ['beta'] }),
      rule('include', { type: 'user', userIds: ['alice'] })
    ];
    const result = previewFeatureFlag(
      baseFlag(),
      rules,
      baseCtx({ userId: 'alice' })
    );
    expect(result).toEqual({
      result: true,
      reason: 'included-by-rule',
      matchedRule: { index: 1, type: 'user', effect: 'include' }
    });
  });

  it('reason "not-included" with null matchedRule when includes exist but none match', () => {
    const rules = [rule('include', { type: 'user', userIds: ['alice'] })];
    const result = previewFeatureFlag(
      baseFlag(),
      rules,
      baseCtx({ userId: 'carol' })
    );
    expect(result).toEqual({
      result: false,
      reason: 'not-included',
      matchedRule: null
    });
  });

  it('reason "not-included" when an include rule exists and no exclude rule matched', () => {
    const rules = [
      rule('include', { type: 'role', roleNames: ['beta'] }),
      rule('exclude', { type: 'role', roleNames: ['banned'] })
    ];
    const result = previewFeatureFlag(
      baseFlag(),
      rules,
      baseCtx({ roles: ['plain'] })
    );
    expect(result).toEqual({
      result: false,
      reason: 'not-included',
      matchedRule: null
    });
  });

  it('returns the first matching exclude rule (excludes short-circuit before includes)', () => {
    const rules = [
      rule('include', { type: 'user', userIds: ['alice'] }),
      rule('exclude', { type: 'role', roleNames: ['banned'] }),
      rule('exclude', { type: 'user', userIds: ['alice'] })
    ];
    const result = previewFeatureFlag(
      baseFlag(),
      rules,
      baseCtx({ userId: 'alice', roles: ['banned'] })
    );
    expect(result.matchedRule?.index).toBe(1);
    expect(result.reason).toBe('excluded');
  });

  it('result.boolean matches evaluateFeatureFlag for the same input (consistency invariant)', () => {
    const cases: Array<{
      flag: EvaluatorFlag;
      rules: EvaluatorRule[];
      ctx: FeatureFlagEvaluationContext;
    }> = [
      { flag: baseFlag({ enabled: false }), rules: [], ctx: baseCtx() },
      {
        flag: baseFlag({ environments: ['production'] }),
        rules: [],
        ctx: baseCtx({ env: 'staging' })
      },
      {
        flag: baseFlag(),
        rules: [rule('include', { type: 'user', userIds: ['alice'] })],
        ctx: baseCtx({ userId: 'alice' })
      },
      {
        flag: baseFlag(),
        rules: [rule('include', { type: 'user', userIds: ['alice'] })],
        ctx: baseCtx({ userId: 'bob' })
      },
      {
        flag: baseFlag(),
        rules: [rule('exclude', { type: 'role', roleNames: ['banned'] })],
        ctx: baseCtx({ roles: ['banned'] })
      },
      {
        flag: baseFlag(),
        rules: [rule('exclude', { type: 'role', roleNames: ['banned'] })],
        ctx: baseCtx({ roles: ['member'] })
      },
      { flag: baseFlag(), rules: [], ctx: baseCtx() }
    ];
    for (const c of cases) {
      const previewResult = previewFeatureFlag(c.flag, c.rules, c.ctx).result;
      const evalResult = evaluateFeatureFlag(c.flag, c.rules, c.ctx);
      expect(previewResult).toBe(evalResult);
    }
  });
});

describe('percentageBucket — stability and distribution', () => {
  it('returns the same bucket for the same (id, flagKey)', () => {
    expect(percentageBucket('user-1', 'demo-flag')).toBe(
      percentageBucket('user-1', 'demo-flag')
    );
  });

  it('returns different buckets for the same id across different flagKeys (mostly)', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `user-${i}`);
    let diffs = 0;
    for (const id of ids) {
      if (percentageBucket(id, 'flag-a') !== percentageBucket(id, 'flag-b')) {
        diffs++;
      }
    }
    expect(diffs).toBeGreaterThanOrEqual(90);
  });

  it('returns a value in [0, 100)', () => {
    for (let i = 0; i < 50; i++) {
      const b = percentageBucket(`id-${i}`, 'demo');
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('distributes 10 000 synthetic ids roughly uniformly', () => {
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < 10_000; i++) {
      const bucket = percentageBucket(`user-${i}`, 'uniformity-flag');
      counts[Math.floor(bucket / 10)]++;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });

  it('integrates with evaluator: 10% percentage rule selects ~10% of users', () => {
    const rules = [rule('include', { type: 'percentage', percent: 10 })];
    let hits = 0;
    for (let i = 0; i < 10_000; i++) {
      if (
        evaluateFeatureFlag(baseFlag(), rules, baseCtx({ userId: `user-${i}` }))
      ) {
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(900);
    expect(hits).toBeLessThan(1100);
  });
});

describe('anonymousEvaluationNeedsAnonId', () => {
  const percentage = { payload: { type: 'percentage', percent: 50 } } as const;
  const attribute = {
    payload: { type: 'attribute', field: 'email', op: 'eq', value: 'a@b.c' }
  } as const;
  const flag = (
    overrides: Partial<AnonymousEvaluatorFlag> = {}
  ): AnonymousEvaluatorFlag => ({
    ...baseFlag(),
    public: true,
    rules: [percentage],
    ...overrides
  });

  it('is true for a live public flag with a percentage rule', () => {
    expect(anonymousEvaluationNeedsAnonId([flag()], 'production')).toBe(true);
  });

  it('is true when the percentage rule is an exclude', () => {
    expect(
      anonymousEvaluationNeedsAnonId(
        [flag({ rules: [attribute, percentage] })],
        'production'
      )
    ).toBe(true);
  });

  it.each([
    ['no flags', []],
    ['a private flag', [flag({ public: false })]],
    ['a disabled flag', [flag({ enabled: false })]],
    ['a flag of another environment', [flag({ environments: ['staging'] })]],
    ['no percentage rule', [flag({ rules: [attribute] })]]
  ])('is false with %s', (_label, flags: AnonymousEvaluatorFlag[]) => {
    expect(anonymousEvaluationNeedsAnonId(flags, 'production')).toBe(false);
  });

  it('is true for a flag scoped to the current environment', () => {
    expect(
      anonymousEvaluationNeedsAnonId(
        [flag({ environments: ['production'] })],
        'production'
      )
    ).toBe(true);
  });
});

describe('signedInEvaluationNeedsAnonId', () => {
  const device = {
    payload: { type: 'percentage', percent: 50, bucketBy: 'device' }
  } as const;
  const flag = (
    overrides: Partial<RolloutEvaluatorFlag> = {}
  ): RolloutEvaluatorFlag => ({
    ...baseFlag(),
    rules: [device],
    ...overrides
  });

  it('is true for a live flag with a device rule', () => {
    expect(signedInEvaluationNeedsAnonId([flag()], 'production')).toBe(true);
  });

  it.each([
    ['no flags', []],
    ['a disabled flag', [flag({ enabled: false })]],
    ['a flag of another environment', [flag({ environments: ['staging'] })]],
    [
      'a percentage rule bucketed by user',
      [flag({ rules: [{ payload: { type: 'percentage', percent: 50 } }] })]
    ]
  ])('is false with %s', (_label, flags: RolloutEvaluatorFlag[]) => {
    expect(signedInEvaluationNeedsAnonId(flags, 'production')).toBe(false);
  });
});
