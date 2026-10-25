import { createMongoAbility } from '@casl/ability';
import type { ResolvedPermission, SubjectMaps } from '@app/shared/types';
import {
  compileAbilityRules,
  dedupPermissions
} from '@app/shared/utils/ability-rules';

const SUBJECT_MAP: Record<string, string> = {
  users: 'User',
  roles: 'Role',
  permissions: 'Permission',
  profile: 'Profile',
  // Only reachable through a DB write that bypassed ResourceService.
  wildcard: 'all'
};

const ORPHANED_SUBJECT_MAP: Record<string, string> = {
  legacy: 'LegacyThing'
};

const ALL_ACTIONS = ['create', 'read', 'update', 'delete', 'search', 'manage'];

// Every resource offers and evaluates every action, so the cases below test
// condition resolution alone; the declared-list rules have their own block.
const ACTION_MAP: Record<string, string[]> = Object.fromEntries(
  [...Object.keys(SUBJECT_MAP), ...Object.keys(ORPHANED_SUBJECT_MAP)].map(
    (name) => [name, ALL_ACTIONS]
  )
);

const DEFAULT_MAPS: SubjectMaps = {
  active: SUBJECT_MAP,
  orphaned: ORPHANED_SUBJECT_MAP,
  grantableActions: ACTION_MAP,
  conditionalActions: ACTION_MAP
};

const grant = (
  resource: string,
  action: string,
  conditions: ResolvedPermission['conditions'] = null,
  permission = `${resource}:${action}`
): ResolvedPermission => ({ resource, action, permission, conditions });

describe('compileAbilityRules', () => {
  const logger = { warn: jest.fn(), error: jest.fn() };

  const abilityOf = (
    permissions: ResolvedPermission[],
    maps: SubjectMaps = DEFAULT_MAPS
  ) =>
    createMongoAbility(
      compileAbilityRules('user-1', false, permissions, maps, logger)
    );

  beforeEach(() => {
    logger.warn.mockReset();
    logger.error.mockReset();
  });

  it('should grant full access to a super user, whatever the permissions', () => {
    const rules = compileAbilityRules(
      'user-1',
      true,
      [grant('users', 'read', { effect: 'deny' })],
      DEFAULT_MAPS,
      logger
    );

    expect(rules).toEqual([{ action: 'manage', subject: 'all' }]);
  });

  describe('declared action lists', () => {
    const OWN_RECORD = { ownership: { userField: 'id' } };
    const maps: SubjectMaps = {
      active: SUBJECT_MAP,
      orphaned: {},
      grantableActions: { users: ['read', 'update'] },
      conditionalActions: { users: ['update'] }
    };

    it('registers no allow on an action the resource does not offer', () => {
      const ability = abilityOf([grant('users', 'delete')], maps);

      expect(ability.can('delete', 'User')).toBe(false);
    });

    it('still registers a deny on an action the resource does not offer', () => {
      const ability = abilityOf(
        [grant('users', 'read'), grant('users', 'read', { effect: 'deny' })],
        maps
      );

      expect(ability.can('read', 'User')).toBe(false);
    });

    it('registers no allow whose condition no check of the action reads', () => {
      const ability = abilityOf([grant('users', 'read', OWN_RECORD)], maps);

      expect(ability.can('read', 'User')).toBe(false);
    });

    it('widens a deny whose condition no check reads into a blanket deny', () => {
      const ability = abilityOf(
        [
          grant('users', 'read'),
          grant('users', 'read', { effect: 'deny', ...OWN_RECORD })
        ],
        maps
      );

      expect(ability.can('read', 'User')).toBe(false);
    });

    it('registers no allow whose condition names a field off the allow-list', () => {
      const ability = abilityOf(
        [grant('users', 'update', { fieldMatch: { password: ['x'] } })],
        maps
      );

      expect(ability.can('update', 'User')).toBe(false);
    });

    it('widens a deny on a misspelt field into a blanket deny', () => {
      const ability = abilityOf(
        [
          grant('users', 'update'),
          grant('users', 'update', {
            effect: 'deny',
            fieldMatch: { Name: ['Typo'] }
          })
        ],
        maps
      );

      expect(ability.can('update', 'User')).toBe(false);
    });

    it('keeps a condition on an action whose checks read the record', () => {
      const ability = abilityOf([grant('users', 'update', OWN_RECORD)], maps);

      expect(ability.can('update', 'User')).toBe(true);
      expect(ability.rulesFor('update', 'User')[0].conditions).toEqual({
        id: 'user-1'
      });
    });
  });

  it('should grant permission without conditions', () => {
    const ability = abilityOf([grant('users', 'read')]);

    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(false);
  });

  it('should use userField from ownership condition as the condition key', () => {
    const ability = abilityOf([
      grant(
        'users',
        'update',
        { ownership: { userField: 'email' } },
        'users:update:own'
      )
    ]);

    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        email: 'user-1'
      } as never)
    ).toBe(true);
    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        email: 'user-2'
      } as never)
    ).toBe(false);
  });

  it('should use "id" field when userField is "id"', () => {
    const ability = abilityOf([
      grant(
        'users',
        'update',
        { ownership: { userField: 'id' } },
        'users:update:own'
      )
    ]);

    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        id: 'user-1'
      } as never)
    ).toBe(true);
    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        id: 'user-2'
      } as never)
    ).toBe(false);
  });

  it('should skip permissions for unknown resources and log a warning', () => {
    const ability = abilityOf([
      grant('unknown-resource', 'read', null, 'unknown:read')
    ]);

    expect(ability.can('read', 'User')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown-resource')
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('user-1'));
  });

  it('should not grant an allow whose resource is orphaned', () => {
    const ability = abilityOf([grant('legacy', 'read')]);

    expect(ability.rules).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('legacy'));
  });

  it('should keep a deny whose resource is orphaned rather than drop it', () => {
    const ability = abilityOf([grant('legacy', 'read', { effect: 'deny' })]);

    const [rule, ...rest] = ability.rules;
    expect(rest).toHaveLength(0);
    expect(rule.inverted).toBe(true);
    expect(rule.action).toBe('read');
    expect(rule.subject).toBe('LegacyThing');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should log at error level when a deny names a resource in neither map', () => {
    const ability = abilityOf([grant('ghost', 'read', { effect: 'deny' })]);

    expect(ability.rules).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ghost'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('user-1')
    );
  });

  describe('reserved CASL keywords', () => {
    it('should not register an allow whose action is reserved', () => {
      const ability = abilityOf([grant('users', 'manage')]);

      expect(ability.rules).toHaveLength(0);
      expect(ability.can('manage', 'User')).toBe(false);
      expect(ability.can('delete', 'User')).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('users:manage')
      );
    });

    it('should not register an allow whose subject is reserved', () => {
      const ability = abilityOf([grant('wildcard', 'read')]);

      expect(ability.rules).toHaveLength(0);
      expect(ability.can('read', 'User')).toBe(false);
      expect(ability.can('read', 'Role')).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('wildcard:read')
      );
    });

    it('should keep a deny whose action is reserved', () => {
      const ability = abilityOf([
        grant('users', 'read'),
        grant('users', 'manage', { effect: 'deny' })
      ]);

      expect(ability.can('read', 'User')).toBe(false);
    });

    it('should ignore a reserved allow while honouring the rest of the set', () => {
      const ability = abilityOf([
        grant('users', 'manage'),
        grant('roles', 'read')
      ]);

      expect(ability.can('read', 'Role')).toBe(true);
      expect(ability.can('read', 'User')).toBe(false);
    });
  });

  it('should handle multiple permissions for different resources', () => {
    const ability = abilityOf([
      grant('users', 'read'),
      grant('roles', 'search')
    ]);

    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('search', 'Role')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(false);
  });

  it('should apply safe custom conditions as MongoQuery', () => {
    const ability = abilityOf([
      grant('users', 'read', {
        custom: '{"name":{"$in":["active","pending"]}}'
      })
    ]);

    expect(
      ability.can('read', {
        __caslSubjectType__: 'User',
        name: 'active'
      } as never)
    ).toBe(true);
    expect(
      ability.can('read', {
        __caslSubjectType__: 'User',
        name: 'deleted'
      } as never)
    ).toBe(false);
  });

  it('should skip custom conditions containing $where and log a warning', () => {
    const ability = abilityOf([
      grant('users', 'read', { custom: '{"$where":"function(){return true}"}' })
    ]);

    // $where block skipped -> no conditions applied -> unconditional deny
    expect(ability.can('read', 'User')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('$where'));
  });

  it('should skip custom conditions containing nested $where', () => {
    const ability = abilityOf([
      grant('users', 'read', {
        custom: '{"$or":[{"name":"active"},{"$where":"hack"}]}'
      })
    ]);

    expect(ability.can('read', 'User')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('$where'));
  });

  it('should skip an allow whose custom uses an operator outside the allowed set', () => {
    const ability = abilityOf([
      grant('users', 'read', { custom: '{"email":{"$regex":"x"}}' })
    ]);

    // $regex has no faithful SQL translation, so honouring it here would grant
    // a record that list/search never returns - the grant fails closed instead.
    expect(ability.can('read', 'User')).toBe(false);
    expect(
      ability.can('read', {
        __caslSubjectType__: 'User',
        email: 'x@example.com'
      } as never)
    ).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('$regex'));
  });

  it('should widen a deny into a blanket deny when its custom uses an operator outside the allowed set', () => {
    const ability = abilityOf([
      grant('users', 'update'),
      grant('users', 'update', {
        effect: 'deny',
        custom: '{"email":{"$regex":"x"}}'
      })
    ]);

    expect(ability.can('update', 'User')).toBe(false);
    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        email: 'someone@example.com'
      } as never)
    ).toBe(false);
  });

  it('should skip custom conditions containing __proto__', () => {
    const ability = abilityOf([
      grant('users', 'read', { custom: '{"__proto__":{"admin":true}}' })
    ]);

    expect(ability.can('read', 'User')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('__proto__')
    );
  });

  it('should veto the ENTIRE permission when a prototype-pollution key sits next to a safe branch', () => {
    // End-to-end check that a single resolver veto (skipPermission) wins over
    // every other branch in the same conditions object - the safe `ownership`
    // fragment must not leak through when the `custom` resolver rejects the
    // payload.
    const ability = abilityOf([
      grant('users', 'update', {
        ownership: { userField: 'email' },
        custom:
          '{"$or":[{"name":"active"},{"profile":{"constructor":{"x":1}}}]}'
      })
    ]);

    // No rules registered -> cannot update even own records.
    expect(
      ability.can('update', {
        __caslSubjectType__: 'User',
        email: 'user-1',
        name: 'active'
      } as never)
    ).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('constructor')
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('users:update')
    );

    // Sanity: original prototype not polluted by the parsed payload.
    expect((Object.prototype as Record<string, unknown>)['x']).toBeUndefined();
  });

  describe('effect: deny (inverted rules)', () => {
    it('should block access when a deny rule with no conditions follows an allow', () => {
      const ability = abilityOf([
        grant('users', 'update'),
        grant('users', 'update', { effect: 'deny' })
      ]);

      expect(ability.can('update', 'User')).toBe(false);
    });

    it('should register deny after allow regardless of input order', () => {
      const ability = abilityOf([
        grant('users', 'update', { effect: 'deny' }),
        grant('users', 'update')
      ]);

      // Deny reordered after allow -> blanket deny wins.
      expect(ability.can('update', 'User')).toBe(false);
    });

    it('should allow unconditionally when only a deny rule with matching conditions exists but record does not match', () => {
      const ability = abilityOf([
        grant('users', 'update'),
        grant('users', 'update', {
          effect: 'deny',
          custom: '{"name":{"$in":["archived"]}}'
        })
      ]);

      // Blanket subject-type check with no instance - CASL answers from the
      // allow because the conditional deny cannot decide without a record.
      expect(ability.can('update', 'User')).toBe(true);

      // Instance with non-matching name -> only the allow applies.
      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          name: 'active'
        } as never)
      ).toBe(true);

      // Instance with matching name -> deny rule blocks.
      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          name: 'archived'
        } as never)
      ).toBe(false);
    });

    it('should apply conditional deny alongside ownership-based allow', () => {
      const ability = abilityOf([
        grant(
          'users',
          'update',
          { ownership: { userField: 'email' } },
          'users:update:own'
        ),
        grant('users', 'update', {
          effect: 'deny',
          fieldMatch: { name: ['locked'] }
        })
      ]);

      // Own and unlocked -> allowed.
      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          email: 'user-1',
          name: 'active'
        } as never)
      ).toBe(true);

      // Own but locked -> deny overrides.
      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          email: 'user-1',
          name: 'locked'
        } as never)
      ).toBe(false);

      // Not own -> allow never matched.
      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          email: 'user-2',
          name: 'active'
        } as never)
      ).toBe(false);
    });

    it('should register a blanket deny when a deny condition is vetoed (unsafe custom)', () => {
      const ability = abilityOf([
        grant('users', 'update'),
        grant('users', 'update', {
          effect: 'deny',
          custom: '{"$where":"hack"}'
        })
      ]);

      // The broken deny must not vanish (that would fail open) - it widens
      // into an unconditional deny instead.
      expect(ability.can('update', 'User')).toBe(false);
    });

    it('should register a blanket deny when a deny condition owns a "$"-prefixed field', () => {
      const ability = abilityOf([
        grant('users', 'update'),
        grant('users', 'update', {
          effect: 'deny',
          ownership: { userField: '$or' }
        })
      ]);

      // Without the veto the deny would be registered as `{ $or: 'user-1' }`,
      // which ucast can never match - the deny would silently stop denying.
      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          email: 'user-1'
        } as never)
      ).toBe(false);
    });

    it('should register a blanket deny when a deny condition resolves to an empty query', () => {
      const ability = abilityOf([
        grant('users', 'update'),
        grant('users', 'update', {
          effect: 'deny',
          fieldMatch: { name: [] }
        })
      ]);

      expect(ability.can('update', 'User')).toBe(false);
    });

    it('should treat conditions.effect === "allow" as the default', () => {
      const ability = abilityOf([grant('users', 'read', { effect: 'allow' })]);

      expect(ability.can('read', 'User')).toBe(true);
    });
  });

  describe('fail-closed empty condition resolution', () => {
    it.each<[string, ResolvedPermission['conditions']]>([
      ['empty fieldMatch array', { fieldMatch: { someField: [] } }],
      ['unknown userAttr attribute', { userAttr: { ownerId: 'unknownAttr' } }],
      ['custom that parses to {}', { custom: '{}' }],
      ['malformed custom JSON', { custom: '{not-valid-json' }]
    ])('should grant nothing (not everything) for %s', (_label, conditions) => {
      const ability = abilityOf([grant('users', 'update', conditions)]);

      expect(ability.can('update', 'User')).toBe(false);
      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          id: 'user-2'
        } as never)
      ).toBe(false);
    });

    it('should veto the whole permission when a malformed branch accompanies a resolving one', () => {
      // An empty fieldMatch array is malformed input: honoring only the
      // ownership branch would drop the authored fieldMatch restriction, so
      // the permission fails closed instead of granting a narrower rule.
      const ability = abilityOf([
        grant(
          'users',
          'update',
          { ownership: { userField: 'email' }, fieldMatch: { name: [] } },
          'users:update:own'
        )
      ]);

      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          email: 'user-1'
        } as never)
      ).toBe(false);
      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          email: 'user-2'
        } as never)
      ).toBe(false);
    });

    it('should still grant conditionally when a benign custom "{}" accompanies a resolving branch', () => {
      const ability = abilityOf([
        grant(
          'users',
          'update',
          { ownership: { userField: 'email' }, custom: '{}' },
          'users:update:own'
        )
      ]);

      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          email: 'user-1'
        } as never)
      ).toBe(true);
      expect(
        ability.can('update', {
          __caslSubjectType__: 'User',
          email: 'user-2'
        } as never)
      ).toBe(false);
    });
  });
});

describe('dedupPermissions', () => {
  it('should keep the first of equal grants and label each by resource and action', () => {
    expect(
      dedupPermissions([
        { resource: 'users', action: 'read', conditions: null },
        { resource: 'users', action: 'read', conditions: null }
      ])
    ).toEqual([
      {
        resource: 'users',
        action: 'read',
        permission: 'users:read',
        conditions: null
      }
    ]);
  });

  it('should keep two grants of one permission whose conditions differ', () => {
    const result = dedupPermissions([
      {
        resource: 'users',
        action: 'update',
        conditions: { effect: 'deny', fieldMatch: { name: ['a'] } }
      },
      {
        resource: 'users',
        action: 'update',
        conditions: { effect: 'deny', fieldMatch: { name: ['b'] } }
      },
      { resource: 'users', action: 'update', conditions: null }
    ]);

    expect(result.map((p) => p.conditions)).toEqual([
      { effect: 'deny', fieldMatch: { name: ['a'] } },
      { effect: 'deny', fieldMatch: { name: ['b'] } },
      null
    ]);
  });
});
