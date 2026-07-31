/**
 * Shape validation for the structured PermissionCondition branches
 * (ownership / fieldMatch / userAttr).
 *
 * Used at three layers:
 * 1. DTO validation (server input) - rejects a malformed branch with 400
 * 2. Condition resolution (server ability factory + mock rule packing) -
 *    vetoes a stored malformed branch so it fails closed instead of
 *    silently dropping the restriction and widening the grant
 * 3. Client condition editors - inline feedback before submit
 *
 * Each finder returns a human-readable error string, or `null` when the
 * value matches the declared shape.
 */

import { PROTOTYPE_KEYS } from './mongo-query-safety';

export const CONDITION_MAX_FIELDS = 32;
export const CONDITION_MAX_FIELD_MATCH_VALUES = 100;
export const CONDITION_MAX_KEY_LENGTH = 128;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function findKeyError(branch: string, key: string): string | null {
  if (key.trim().length === 0) {
    return `${branch} keys must be non-empty strings`;
  }
  if (key.length > CONDITION_MAX_KEY_LENGTH) {
    return `${branch} keys must be at most ${CONDITION_MAX_KEY_LENGTH} characters`;
  }
  if (PROTOTYPE_KEYS.has(key)) {
    return `Prototype pollution key "${key}" in ${branch}`;
  }
  // The structured branches write their keys into field position of the
  // MongoQuery, where a leading "$" turns the key into an operator. CASL then
  // builds a rule that matches no record while the SQL translator drops it, so
  // an allow silently grants nothing and a deny silently stops denying.
  if (key.startsWith('$')) {
    return `MongoQuery operator key "${key}" is not allowed in ${branch}`;
  }
  return null;
}

/** ownership must be exactly `{ userField: <non-empty string> }`. */
export function findOwnershipShapeError(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'ownership must be an object';
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'userField') {
    return 'ownership must have exactly one key "userField"';
  }
  const userField = value['userField'];
  if (typeof userField !== 'string' || userField.trim().length === 0) {
    return 'ownership.userField must be a non-empty string';
  }
  return findKeyError('ownership.userField', userField);
}

/** fieldMatch values must each be a non-empty array of JSON scalars. */
export function findFieldMatchShapeError(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'fieldMatch must be an object';
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return 'fieldMatch must have at least one field';
  }
  if (entries.length > CONDITION_MAX_FIELDS) {
    return `fieldMatch must have at most ${CONDITION_MAX_FIELDS} fields`;
  }
  for (const [key, values] of entries) {
    const keyError = findKeyError('fieldMatch', key);
    if (keyError) {
      return keyError;
    }
    if (!Array.isArray(values) || values.length === 0) {
      return `fieldMatch.${key} must be a non-empty array of values`;
    }
    if (values.length > CONDITION_MAX_FIELD_MATCH_VALUES) {
      return `fieldMatch.${key} must have at most ${CONDITION_MAX_FIELD_MATCH_VALUES} values`;
    }
    if (!values.every(isJsonScalar)) {
      return `fieldMatch.${key} values must be strings, numbers, booleans or null`;
    }
  }
  return null;
}

/** userAttr values must each be a non-empty attribute-name string. */
export function findUserAttrShapeError(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'userAttr must be an object';
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return 'userAttr must have at least one field';
  }
  if (entries.length > CONDITION_MAX_FIELDS) {
    return `userAttr must have at most ${CONDITION_MAX_FIELDS} fields`;
  }
  for (const [key, attrName] of entries) {
    const keyError = findKeyError('userAttr', key);
    if (keyError) {
      return keyError;
    }
    if (typeof attrName !== 'string' || attrName.trim().length === 0) {
      return `userAttr.${key} must be a non-empty attribute name string`;
    }
    const attrError = findKeyError(`userAttr.${key}`, attrName);
    if (attrError) {
      return attrError;
    }
  }
  return null;
}

/**
 * Branches that resolve against the acting user's identity rather than against
 * a stored value, so they can only be evaluated on a record that already
 * exists.
 */
export const IDENTITY_BOUND_CONDITION_BRANCHES = [
  'ownership',
  'userAttr'
] as const;

/**
 * Returns the first identity-bound branch present in a condition, or null.
 */
export function findIdentityBoundBranch(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return null;
  }
  return (
    IDENTITY_BOUND_CONDITION_BRANCHES.find(
      (branch) => value[branch] !== undefined && value[branch] !== null
    ) ?? null
  );
}

/**
 * Rejects a condition branch the given action can never satisfy.
 *
 * `ownership` and `userAttr` both resolve to the acting user's id, which a
 * record that does not exist yet cannot carry: attached to a `create` grant
 * they deny every create instead of restricting it, so the grant reads as a
 * restriction in the admin UI while being silently dead.
 */
export function findConditionActionError(
  actionName: string,
  conditions: unknown
): string | null {
  if (actionName !== 'create') {
    return null;
  }
  const branch = findIdentityBoundBranch(conditions);
  if (!branch) {
    return null;
  }
  return `conditions.${branch} matches the acting user's id, which a record that does not exist yet can never carry`;
}
