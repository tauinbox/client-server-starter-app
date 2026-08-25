import type { ResolvedPermission } from '@app/shared/types';
import {
  CaslAbilityFactory,
  type RoleInfo
} from '../casl/casl-ability.factory';
import { buildAbility } from './grant-scope-report';

/**
 * `buildAbility` reproduces `CaslAbilityFactory.createForUser` because a
 * read-only report should not boot Nest DI and a repository just to read rules.
 * Documenting that duplication does not stop it drifting, so this spec drives
 * one permission set through BOTH implementations and requires identical rules.
 *
 * If this fails, the report has started judging grants against an ability the
 * application would never build - fix `buildAbility`, do not relax the spec.
 */

const SUBJECT_MAP: Record<string, string> = {
  User: 'User',
  Role: 'Role'
};
const ORPHANED_SUBJECT_MAP: Record<string, string> = {
  Legacy: 'Legacy'
};

const subjectSets = {
  active: new Set(Object.keys(SUBJECT_MAP)),
  orphaned: new Set(Object.keys(ORPHANED_SUBJECT_MAP))
};

/**
 * Every branch `buildAbility` implements: unconditional, ownership-conditioned,
 * a deny, a vetoed allow, a vetoed deny, a reserved action name, a reserved
 * subject, an allow on an orphaned resource, and a deny on one.
 */
const PERMISSIONS: ResolvedPermission[] = [
  {
    resource: 'Role',
    action: 'read',
    permission: 'read:Role',
    conditions: null
  },
  {
    resource: 'User',
    action: 'update',
    permission: 'update:User',
    conditions: { ownership: { userField: 'id' } }
  },
  {
    resource: 'User',
    action: 'read',
    permission: 'read:User',
    conditions: { fieldMatch: { isActive: [true] } }
  },
  {
    resource: 'User',
    action: 'delete',
    permission: 'delete:User',
    conditions: { effect: 'deny' }
  },
  {
    resource: 'Role',
    action: 'update',
    permission: 'update:Role',
    // Unknown userAttr attribute - the resolver vetoes it, so the allow grants
    // nothing.
    conditions: { userAttr: { managerId: 'department' } }
  },
  {
    resource: 'Role',
    action: 'delete',
    permission: 'delete:Role',
    // A vetoed DENY must still deny everything rather than vanish.
    conditions: { effect: 'deny', userAttr: { managerId: 'department' } }
  },
  {
    resource: 'User',
    action: 'manage',
    permission: 'manage:User',
    conditions: null
  },
  {
    resource: 'Legacy',
    action: 'read',
    permission: 'read:Legacy',
    conditions: null
  },
  {
    resource: 'Legacy',
    action: 'update',
    permission: 'update:Legacy',
    conditions: { effect: 'deny' }
  },
  {
    resource: 'User',
    action: 'create',
    permission: 'create:User',
    // Branch-less condition object: a legitimate unconditional rule.
    conditions: { effect: 'allow' }
  }
];

function makeFactory(): CaslAbilityFactory {
  const resourceService = {
    getSubjectMaps: jest.fn().mockResolvedValue({
      active: SUBJECT_MAP,
      orphaned: ORPHANED_SUBJECT_MAP
    })
  };
  return new CaslAbilityFactory(
    // @ts-expect-error testing mock — only getSubjectMaps is needed
    resourceService
  );
}

/** Normalises rules to a comparable, order-preserving shape. */
function rulesOf(ability: {
  rules: readonly {
    action: unknown;
    subject?: unknown;
    conditions?: unknown;
    inverted?: boolean;
  }[];
}): string {
  return JSON.stringify(
    ability.rules.map((r) => ({
      action: r.action,
      subject: r.subject,
      conditions: r.conditions ?? null,
      inverted: r.inverted ?? false
    }))
  );
}

describe('buildAbility stays in step with CaslAbilityFactory', () => {
  it('produces identical rules for a non-super user', async () => {
    const factory = makeFactory();
    const roles: RoleInfo[] = [{ name: 'delegated-admin', isSuper: false }];

    const fromFactory = await factory.createForUser(
      'user-1',
      roles,
      PERMISSIONS
    );
    const fromReport = buildAbility('user-1', false, PERMISSIONS, subjectSets);

    expect(rulesOf(fromReport)).toEqual(rulesOf(fromFactory));
  });

  it('produces identical rules for a super user', async () => {
    const factory = makeFactory();
    const roles: RoleInfo[] = [{ name: 'admin', isSuper: true }];

    const fromFactory = await factory.createForUser(
      'user-1',
      roles,
      PERMISSIONS
    );
    const fromReport = buildAbility('user-1', true, PERMISSIONS, subjectSets);

    expect(rulesOf(fromReport)).toEqual(rulesOf(fromFactory));
  });

  it('produces identical rules when the user has no permissions', async () => {
    const factory = makeFactory();

    const fromFactory = await factory.createForUser(
      'user-1',
      [{ name: 'empty', isSuper: false }],
      []
    );
    const fromReport = buildAbility('user-1', false, [], subjectSets);

    expect(rulesOf(fromReport)).toEqual(rulesOf(fromFactory));
  });
});
