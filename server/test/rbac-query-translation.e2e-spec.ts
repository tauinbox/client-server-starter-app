// Integration regression for BKL-008: end-to-end CASL ability → SQL query
// translation. Wires the real CaslAbilityFactory with all built-in resolvers,
// builds abilities for several scenarios (custom $or, $ne, mixed translatable
// + untranslatable), and asserts the translator produces SQL that filters
// users to the expected subset — including the fail-closed path where any
// untranslatable fragment causes the entire rule to be dropped.

import { Logger } from '@nestjs/common';
import type { ResolvedPermission } from '@app/shared/types';
import type { SelectQueryBuilder } from 'typeorm';
import {
  CaslAbilityFactory,
  RoleInfo
} from '../src/modules/auth/casl/casl-ability.factory';
import {
  CustomResolver,
  FieldMatchResolver,
  OwnershipResolver,
  UserAttrResolver
} from '../src/modules/auth/casl/condition-resolvers';
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
}

function fakeQb(): { qb: SelectQueryBuilder<User>; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const qb = {
    andWhere: jest.fn((arg: unknown, params?: unknown) => {
      if (typeof arg === 'string') {
        calls.push({ sql: arg, params: params as Record<string, unknown> });
      } else if (
        typeof arg === 'object' &&
        arg !== null &&
        'whereFactory' in (arg as Record<string, unknown>)
      ) {
        const sub = fakeQb();
        (arg as { whereFactory: (q: typeof sub.qb) => void }).whereFactory(
          sub.qb
        );
        calls.push({
          sql: `(${sub.calls.map((c) => c.sql).join(' OR ')})`,
          params: sub.calls.reduce(
            (acc, c) => ({ ...acc, ...(c.params ?? {}) }),
            {} as Record<string, unknown>
          )
        });
      }
      return qb;
    }),
    where: jest.fn((sql: string, params?: unknown) => {
      calls.push({ sql, params: params as Record<string, unknown> });
      return qb;
    }),
    orWhere: jest.fn((sql: string, params?: unknown) => {
      calls.push({ sql, params: params as Record<string, unknown> });
      return qb;
    })
  } as unknown as SelectQueryBuilder<User>;
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
    { getSubjectMap: jest.fn().mockResolvedValue(SUBJECT_MAP) },
    [
      new OwnershipResolver(),
      new FieldMatchResolver(),
      new UserAttrResolver(),
      new CustomResolver()
    ]
  );
}

const NON_SUPER: RoleInfo[] = [{ name: 'editor', isSuper: false }];

const SAMPLE_USERS = [
  { id: 'u-1', email: 'alice@x.io', isActive: true },
  { id: 'u-2', email: 'bob@x.io', isActive: true },
  { id: 'u-3', email: 'carol@x.io', isActive: false }
];

describe('CASL → SQL query translation (e2e — BKL-008)', () => {
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
