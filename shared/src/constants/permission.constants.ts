import type { PermissionCondition } from '../types/role.types';

export const SYSTEM_ROLES = {
  ADMIN: 'admin',
  USER: 'user'
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/**
 * The only allow grants that the universal `user` role can carry: the
 * self-service permissions. The role reaches every account, so an allow
 * outside this list would open that permission to every user. The ability
 * drops such a row whatever the database holds, and the role routes refuse to
 * write one. A deny is always kept, because it only narrows access.
 */
export const USER_ROLE_PERMISSION_CEILING: readonly {
  resource: string;
  action: string;
  conditions: PermissionCondition | null;
}[] = [
  { resource: 'profile', action: 'update', conditions: null },
  {
    resource: 'users',
    action: 'update',
    conditions: { ownership: { userField: 'id' } }
  }
];

export const ROLE_NAME_MAX_LENGTH = 100;

/**
 * CASL reserved keywords that must not be used as action names.
 * - 'manage' grants universal action access when used in can('manage', subject)
 * - 'all' is the wildcard for both actions and subjects in can('manage', 'all')
 */
export const CASL_RESERVED_ACTION_NAMES: readonly string[] = ['manage', 'all'];

/**
 * CASL reserved keywords that must not be used as resource subjects.
 * - 'all' is the wildcard subject in can(action, 'all')
 */
export const CASL_RESERVED_SUBJECT_NAMES: readonly string[] = ['all'];

/**
 * The record fields that a list filter can translate from a grant condition,
 * per subject. A condition on any other field cannot narrow a list, so the
 * rule that carries it is dropped (fail closed). Every field is NOT NULL: SQL
 * `<>` and `NOT IN` drop NULL rows that the in-memory check keeps.
 */
export const ABILITY_FILTER_FIELDS = {
  User: ['id', 'email', 'name', 'isActive'],
  FeatureFlag: ['id', 'key', 'enabled', 'public']
} as const satisfies Record<string, readonly string[]>;

export type AbilityFilterSubject = keyof typeof ABILITY_FILTER_FIELDS;

/**
 * The record fields that a grant condition can name, per subject. A condition
 * on another field is refused on write and vetoed at run time: the in-memory
 * check reads the whole entity, columns that no response sends included, and
 * a misspelt field in a deny would deny nothing. `User` adds `locale` for a
 * `create` grant; a list filter drops a rule on it. `Permission` conditions
 * are evaluated against the `Resource` record.
 */
export const CONDITION_FIELDS = {
  ...ABILITY_FILTER_FIELDS,
  User: [...ABILITY_FILTER_FIELDS.User, 'locale'],
  Role: ['id', 'name', 'isSystem', 'isSuper'],
  Permission: ['id', 'name', 'subject', 'displayName', 'isSystem']
} as const satisfies Record<string, readonly string[]>;
