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
});
