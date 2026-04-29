import { Logger } from '@nestjs/common';
import { applyAbilityToUserQuery } from './apply-ability.util';
import type { AppAbility } from '../../auth/casl/app-ability';
import type { SelectQueryBuilder } from 'typeorm';
import type { User } from '../entities/user.entity';

function fakeQb() {
  const calls: { sql: string; params?: unknown }[] = [];
  const qb = {
    andWhere: jest.fn((arg: unknown, params?: unknown) => {
      if (typeof arg === 'string') {
        calls.push({ sql: arg, params });
      } else if (
        typeof arg === 'object' &&
        arg !== null &&
        'whereFactory' in (arg as Record<string, unknown>)
      ) {
        // Brackets — invoke its factory against a sub-recorder
        const sub = fakeQb();
        (arg as { whereFactory: (q: typeof sub.qb) => void }).whereFactory(
          sub.qb
        );
        calls.push({
          sql: `(${sub.calls.map((c) => c.sql).join(' OR ')})`,
          params: sub.calls.reduce(
            (acc, c) => ({ ...acc, ...(c.params as object) }),
            {}
          )
        });
      }
      return qb;
    }),
    where: jest.fn((sql: string, params?: unknown) => {
      calls.push({ sql, params });
      return qb;
    }),
    orWhere: jest.fn((sql: string, params?: unknown) => {
      calls.push({ sql, params });
      return qb;
    })
  } as unknown as SelectQueryBuilder<User>;
  return { qb, calls };
}

function ability(opts: {
  manageAll?: boolean;
  rules?: { conditions?: unknown; inverted?: boolean }[];
}): AppAbility {
  const partial = {
    can: jest.fn(
      (action: string, subject: unknown) =>
        opts.manageAll === true && action === 'manage' && subject === 'all'
    ),
    rulesFor: jest.fn(() => opts.rules ?? [])
  };
  // @ts-expect-error partial mock — only can/rulesFor exercised
  return partial as AppAbility;
}

describe('applyAbilityToUserQuery', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns qb unchanged when caller has manage:all', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability({ manageAll: true }), 'search');
    expect(calls).toHaveLength(0);
  });

  it('emits 1 = 0 when no allow rules match', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability({ rules: [] }), 'search');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe('1 = 0');
  });

  it('returns qb unchanged when at least one unconditional allow rule exists', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { id: 'u-1' } }, { conditions: undefined }]
      }),
      'search'
    );
    expect(calls).toHaveLength(0);
  });

  it('translates ownership condition {id: userId} to user.id = :param', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({ rules: [{ conditions: { id: 'caller-uuid' } }] }),
      'search'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('user.id = :abFilter_0');
    expect(calls[0].params).toMatchObject({ abFilter_0: 'caller-uuid' });
  });

  it('translates fieldMatch {email: {$in: [...]}} to user.email IN (...)', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { email: { $in: ['a@x.io', 'b@x.io'] } } }]
      }),
      'search'
    );
    expect(calls[0].sql).toContain('user.email IN (:...abFilter_0)');
    expect(calls[0].params).toMatchObject({
      abFilter_0: ['a@x.io', 'b@x.io']
    });
  });

  it('ORs multiple conditional rules together', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [
          { conditions: { id: 'u-1' } },
          { conditions: { isActive: true } }
        ]
      }),
      'search'
    );
    expect(calls[0].sql).toMatch(/user\.id = :abFilter_0.*OR.*user\.isActive/);
  });

  it('skips inverted rules', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [
          { conditions: { id: 'u-1' }, inverted: true },
          { conditions: { id: 'u-2' } }
        ]
      }),
      'search'
    );
    expect(calls[0].sql).toContain('user.id = :abFilter_0');
    expect(calls[0].params).toMatchObject({ abFilter_0: 'u-2' });
  });

  it('denies by default when conditions reference unknown fields', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({ rules: [{ conditions: { unknownField: 'x' } }] }),
      'search'
    );
    expect(calls[0].sql).toBe('(1 = 0)');
  });

  // ─── operator matrix ────────────────────────────────────────────────────────

  it('translates $ne to <>', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({ rules: [{ conditions: { id: { $ne: 'banned' } } }] }),
      'search'
    );
    expect(calls[0].sql).toContain('user.id <> :abFilter_0');
    expect(calls[0].params).toMatchObject({ abFilter_0: 'banned' });
  });

  it.each([
    ['$gt', '>'],
    ['$gte', '>='],
    ['$lt', '<'],
    ['$lte', '<=']
  ])('translates %s to %s', (op, sqlOp) => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { firstName: { [op]: 'M' } } }]
      }),
      'search'
    );
    expect(calls[0].sql).toContain(`user.firstName ${sqlOp} :abFilter_0`);
    expect(calls[0].params).toMatchObject({ abFilter_0: 'M' });
  });

  it('translates $nin to NOT IN', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { email: { $nin: ['x@x.io', 'y@x.io'] } } }]
      }),
      'search'
    );
    expect(calls[0].sql).toContain('user.email NOT IN (:...abFilter_0)');
    expect(calls[0].params).toMatchObject({
      abFilter_0: ['x@x.io', 'y@x.io']
    });
  });

  it('translates top-level $or with two field equalities', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { $or: [{ id: 'u-1' }, { email: 'a@x.io' }] } }]
      }),
      'search'
    );
    // Inner $or fragment shape: ((user.id = :abFilter_0) OR (user.email = :abFilter_1))
    expect(calls[0].sql).toMatch(
      /user\.id = :abFilter_0.*OR.*user\.email = :abFilter_1/
    );
    expect(calls[0].params).toMatchObject({
      abFilter_0: 'u-1',
      abFilter_1: 'a@x.io'
    });
  });

  it('translates top-level $and with mixed field equalities', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { $and: [{ isActive: true }, { id: 'u-1' }] } }]
      }),
      'search'
    );
    expect(calls[0].sql).toMatch(
      /user\.isActive = :abFilter_0.*AND.*user\.id = :abFilter_1/
    );
  });

  it('translates nested $and inside $or', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [
          {
            conditions: {
              $or: [
                { $and: [{ id: 'u-1' }, { isActive: true }] },
                { email: 'admin@x.io' }
              ]
            }
          }
        ]
      }),
      'search'
    );
    // Outer $or contains an $and group and a single field eq.
    expect(calls[0].sql).toMatch(
      /user\.id = :abFilter_0.*AND.*user\.isActive = :abFilter_1.*OR.*user\.email = :abFilter_2/
    );
    expect(calls[0].params).toMatchObject({
      abFilter_0: 'u-1',
      abFilter_1: true,
      abFilter_2: 'admin@x.io'
    });
  });

  it('translates $not by negating its inner translation', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { $not: { isActive: false } } }]
      }),
      'search'
    );
    expect(calls[0].sql).toContain('NOT (user.isActive = :abFilter_0)');
  });

  it('translates $nor as NOT(a OR b)', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { $nor: [{ id: 'u-1' }, { id: 'u-2' }] } }]
      }),
      'search'
    );
    expect(calls[0].sql).toMatch(
      /NOT \(.*user\.id = :abFilter_0.*OR.*user\.id = :abFilter_1.*\)/
    );
  });

  it('translates mix of equality + $ne in same rule with AND', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { id: 'u-1', isActive: { $ne: true } } }]
      }),
      'search'
    );
    expect(calls[0].sql).toMatch(
      /user\.id = :abFilter_0.*AND.*user\.isActive <> :abFilter_1/
    );
    expect(calls[0].params).toMatchObject({
      abFilter_0: 'u-1',
      abFilter_1: true
    });
  });

  // ─── fail-closed regression (the BKL-008 critical test) ────────────────────

  it('SKIPS THE WHOLE RULE on mixed translatable + unknown operator (regression for BKL-008)', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { id: 'u-1', legacyField: { $exotic: true } } }]
      }),
      'search'
    );
    // Rule was skipped entirely: SQL must NOT contain user.id = ...
    expect(calls[0].sql).not.toContain('user.id = :abFilter_0');
    // Single rule, all skipped → fall through to deny
    expect(calls[0].sql).toBe('(1 = 0)');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('SKIPS THE WHOLE RULE on unknown field-level operator', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { id: { $regex: '^u-' } } }]
      }),
      'search'
    );
    expect(calls[0].sql).toBe('(1 = 0)');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('SKIPS THE WHOLE RULE on unknown logical operator at top level', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { $bogus: [{ id: 'u-1' }] } }]
      }),
      'search'
    );
    expect(calls[0].sql).toBe('(1 = 0)');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('SKIPS THE RULE inside $or when one branch has unknown field', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [
          {
            conditions: {
              $or: [{ id: 'u-1' }, { legacyField: 'x' }]
            }
          }
        ]
      }),
      'search'
    );
    // Whole $or is untranslatable → whole rule dropped.
    expect(calls[0].sql).toBe('(1 = 0)');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('keeps remaining translatable rules when one is skipped', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [
          { conditions: { id: 'u-1', legacyField: { $exotic: true } } },
          { conditions: { id: 'u-2' } }
        ]
      }),
      'search'
    );
    // First rule skipped, second translated; only second survives.
    expect(calls[0].sql).toContain('user.id = :abFilter_0');
    expect(calls[0].sql).not.toContain(':abFilter_1');
    expect(calls[0].params).toMatchObject({ abFilter_0: 'u-2' });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('SKIPS THE RULE on empty $in array (no values means deny intent, not allow-all)', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { email: { $in: [] } } }]
      }),
      'search'
    );
    expect(calls[0].sql).toBe('(1 = 0)');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('SKIPS THE RULE on $or with empty array', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { $or: [] } }]
      }),
      'search'
    );
    expect(calls[0].sql).toBe('(1 = 0)');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('SKIPS THE RULE when comparison operator value is non-scalar', () => {
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(
      qb,
      ability({
        rules: [{ conditions: { id: { $eq: { nested: 'x' } } } }]
      }),
      'search'
    );
    expect(calls[0].sql).toBe('(1 = 0)');
    expect(warnSpy).toHaveBeenCalled();
  });
});
