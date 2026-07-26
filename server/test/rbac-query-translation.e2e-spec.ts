// Integration regression for CASL ability → SQL translation through the real
// CaslAbilityFactory: allow conditions, deny conditions, and the asymmetric
// fail-closed paths (a dropped allow narrows, a dropped deny would widen).

import { Logger } from '@nestjs/common';
import type { ResolvedPermission } from '@app/shared/types';
import { subject } from '@casl/ability';
import type { SelectQueryBuilder } from 'typeorm';
import {
  CaslAbilityFactory,
  RoleInfo
} from '../src/modules/auth/casl/casl-ability.factory';
import type { User } from '../src/modules/users/entities/user.entity';
import { applyAbilityToUserQuery } from '../src/modules/users/utils/apply-ability.util';

const SUBJECT_MAP: Record<string, string> = {
  users: 'User',
  roles: 'Role',
  permissions: 'Permission'
};

interface RecordedCall {
  sql: string;
  params?: Record<string, unknown>;
  connector: 'where' | 'andWhere' | 'orWhere';
}

function fakeQb(): { qb: SelectQueryBuilder<User>; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  // @ts-expect-error - partial SelectQueryBuilder fake: only where methods used
  const qb: SelectQueryBuilder<User> = {
    andWhere: jest.fn((arg: unknown, params?: unknown) => {
      if (typeof arg === 'string') {
        calls.push({
          sql: arg,
          params: params as Record<string, unknown>,
          connector: 'andWhere'
        });
      } else if (
        typeof arg === 'object' &&
        arg !== null &&
        'whereFactory' in (arg as Record<string, unknown>)
      ) {
        const sub = fakeQb();
        (arg as { whereFactory: (q: typeof sub.qb) => void }).whereFactory(
          sub.qb
        );
        // Render with the connector each sub-call actually used: allow rules
        // are ORed, a deny is ANDed on as a negation, so a fixed OR join would
        // make a subtracted deny look identical to an ignored one.
        calls.push({
          sql: `(${sub.calls
            .map((c, i) =>
              i === 0
                ? c.sql
                : `${c.connector === 'orWhere' ? 'OR' : 'AND'} ${c.sql}`
            )
            .join(' ')})`,
          params: sub.calls.reduce(
            (acc, c) => ({ ...acc, ...(c.params ?? {}) }),
            {} as Record<string, unknown>
          ),
          connector: 'andWhere'
        });
      }
      return qb;
    }),
    where: jest.fn((sql: string, params?: unknown) => {
      calls.push({
        sql,
        params: params as Record<string, unknown>,
        connector: 'where'
      });
      return qb;
    }),
    orWhere: jest.fn((sql: string, params?: unknown) => {
      calls.push({
        sql,
        params: params as Record<string, unknown>,
        connector: 'orWhere'
      });
      return qb;
    })
  };
  return { qb, calls };
}

/**
 * Mongo-style matcher that mirrors CASL's runtime semantics for the operator
 * subset the SQL translator handles. Used by tests to compute the expected
 * subset of an in-memory user list before asserting the SQL filters to the
 * same set.
 */
function matches(
  conds: Record<string, unknown>,
  user: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(conds)) {
    if (key === '$or') {
      if (!Array.isArray(value)) return false;
      if (!value.some((c) => matches(c as Record<string, unknown>, user))) {
        return false;
      }
      continue;
    }
    if (key === '$and') {
      if (!Array.isArray(value)) return false;
      if (!value.every((c) => matches(c as Record<string, unknown>, user))) {
        return false;
      }
      continue;
    }
    const userValue = user[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$ne' in op && userValue === op['$ne']) return false;
      if ('$eq' in op && userValue !== op['$eq']) return false;
      if (
        '$in' in op &&
        Array.isArray(op['$in']) &&
        !(op['$in'] as unknown[]).includes(userValue)
      ) {
        return false;
      }
      if (
        '$nin' in op &&
        Array.isArray(op['$nin']) &&
        (op['$nin'] as unknown[]).includes(userValue)
      ) {
        return false;
      }
      continue;
    }
    if (userValue !== value) return false;
  }
  return true;
}

function buildFactory(): CaslAbilityFactory {
  return new CaslAbilityFactory(
    // @ts-expect-error partial mock — only getSubjectMap exercised
    { getSubjectMap: jest.fn().mockResolvedValue(SUBJECT_MAP) }
  );
}

const NON_SUPER: RoleInfo[] = [{ name: 'editor', isSuper: false }];

const SAMPLE_USERS = [
  { id: 'u-1', email: 'alice@x.io', isActive: true },
  { id: 'u-2', email: 'bob@x.io', isActive: true },
  { id: 'u-3', email: 'carol@x.io', isActive: false }
];

describe('CASL → SQL query translation (e2e)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Silence the translator's warn logs (they fire on the fail-closed paths).
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('translates a custom $or permission to SQL that selects exactly the matching users', async () => {
    const factory = buildFactory();
    const customConds = {
      $or: [{ id: 'u-1' }, { id: 'u-3' }]
    };
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:custom',
        conditions: { custom: JSON.stringify(customConds) }
      }
    ];

    const ability = await factory.createForUser(
      'caller-1',
      NON_SUPER,
      permissions
    );

    const expectedIds = SAMPLE_USERS.filter((u) => matches(customConds, u)).map(
      (u) => u.id
    );
    expect(expectedIds).toEqual(['u-1', 'u-3']);

    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability, 'search');

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(
      /user\.id = :abFilter_0.*OR.*user\.id = :abFilter_1/
    );
    expect(calls[0].params).toMatchObject({
      abFilter_0: 'u-1',
      abFilter_1: 'u-3'
    });
  });

  it('translates ownership ($eq) condition: caller sees only their own row', async () => {
    const factory = buildFactory();
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:own',
        conditions: { ownership: { userField: 'id' } }
      }
    ];

    const ability = await factory.createForUser('u-2', NON_SUPER, permissions);

    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability, 'search');

    expect(calls[0].sql).toContain('user.id = :abFilter_0');
    expect(calls[0].params).toMatchObject({ abFilter_0: 'u-2' });
  });

  it('mixed custom condition with one unsupported operator → entire rule dropped (fail-closed)', async () => {
    const factory = buildFactory();
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:mixed',
        conditions: {
          custom: JSON.stringify({
            id: 'u-1',
            email: { $regex: '^.*@x\\.io$' } // unsupported operator
          })
        }
      }
    ];

    const ability = await factory.createForUser(
      'caller-1',
      NON_SUPER,
      permissions
    );

    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability, 'search');

    // The pre-fix translator would have produced `user.id = 'u-1'` and
    // silently ignored the regex — over-sharing the row to the caller.
    // After the fix, the whole rule is dropped → deny-all.
    expect(calls[0].sql).toBe('(1 = 0)');
    expect(calls[0].sql).not.toContain('user.id = :abFilter_0');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('multiple permissions: untranslatable rule is dropped, surviving rule still applies', async () => {
    const factory = buildFactory();
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:bad',
        conditions: {
          custom: JSON.stringify({ legacyField: 'x' }) // unknown field
        }
      },
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:own',
        conditions: { ownership: { userField: 'id' } }
      }
    ];

    const ability = await factory.createForUser('u-2', NON_SUPER, permissions);

    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability, 'search');

    expect(calls[0].sql).toContain('user.id = :abFilter_0');
    expect(calls[0].params).toMatchObject({ abFilter_0: 'u-2' });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('subtracts a deny permission from an unconditional allow', async () => {
    const factory = buildFactory();
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:all',
        conditions: null
      },
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:deny-inactive',
        conditions: {
          effect: 'deny',
          custom: JSON.stringify({ isActive: false })
        }
      }
    ];

    const ability = await factory.createForUser(
      'caller-1',
      NON_SUPER,
      permissions
    );

    // The instance-level check the single-entity endpoints run: the inactive
    // row is rejected, the active ones are not.
    expect(ability.can('search', subject('User', SAMPLE_USERS[0]))).toBe(true);
    expect(ability.can('search', subject('User', SAMPLE_USERS[2]))).toBe(false);

    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability, 'search');

    // Pre-fix the deny was filtered out before translation, the allow was
    // unconditional, and the query came back unrestricted — so the very rows
    // the deny was written to hide were listed with the full admin projection.
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe('(NOT (user.isActive = :abFilter_0))');
    expect(calls[0].params).toMatchObject({ abFilter_0: false });
  });

  it('untranslatable deny drops the whole query to no rows (fail-closed)', async () => {
    const factory = buildFactory();
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:all',
        conditions: null
      },
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:deny-legacy',
        conditions: {
          effect: 'deny',
          custom: JSON.stringify({ legacyField: 'x' }) // unknown field
        }
      }
    ];

    const ability = await factory.createForUser(
      'caller-1',
      NON_SUPER,
      permissions
    );

    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability, 'search');

    // Dropping an allow only narrows, but dropping a deny would widen, so the
    // untranslatable deny must take the whole query down rather than vanish.
    expect(calls[0].sql).toBe('1 = 0');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('vetoed deny (malformed conditions) still blocks every row', async () => {
    const factory = buildFactory();
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:all',
        conditions: null
      },
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:deny-broken',
        conditions: { effect: 'deny', custom: '{ not json' }
      }
    ];

    const ability = await factory.createForUser(
      'caller-1',
      NON_SUPER,
      permissions
    );

    // The factory turns a vetoed deny into an unconditional cannot(); the
    // translator has to honour that rather than treat it as absent.
    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability, 'search');

    expect(calls[0].sql).toBe('1 = 0');
  });

  it('translates fieldMatch ($in) to SQL IN clause', async () => {
    const factory = buildFactory();
    const permissions: ResolvedPermission[] = [
      {
        resource: 'users',
        action: 'search',
        permission: 'users:search:fieldMatch',
        conditions: {
          fieldMatch: { email: ['alice@x.io', 'bob@x.io'] }
        }
      }
    ];

    const ability = await factory.createForUser(
      'caller-1',
      NON_SUPER,
      permissions
    );

    const { qb, calls } = fakeQb();
    applyAbilityToUserQuery(qb, ability, 'search');

    expect(calls[0].sql).toContain('user.email IN (:...abFilter_0)');
    expect(calls[0].params).toMatchObject({
      abFilter_0: ['alice@x.io', 'bob@x.io']
    });
  });
});
