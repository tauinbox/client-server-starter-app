export const SYSTEM_ROLES = {
  ADMIN: 'admin',
  USER: 'user'
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const ROLE_NAME_MAX_LENGTH = 100;

/**
 * The record fields that a list filter can translate from a grant condition,
 * per subject. A condition on any other field cannot narrow a list, so the
 * rule that carries it is dropped (fail closed). Every field is NOT NULL: SQL
 * `<>` and `NOT IN` drop NULL rows that the in-memory check keeps.
 */
export const ABILITY_FILTER_FIELDS = {
  User: ['id', 'email', 'firstName', 'lastName', 'isActive'],
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
