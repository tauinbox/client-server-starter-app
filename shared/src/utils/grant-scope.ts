import { ErrorKeys } from '../constants/error-keys';
import type { ErrorKey } from '../constants/error-status';
import type { PermissionCondition } from '../types/role.types';
import { isJsonScalar, type JsonScalar } from './mongo-query-safety';
import { resolveConditions, type ResolverLogger } from './resolve-conditions';

export interface GrantScopeRule {
  inverted: boolean;
  conditions?: Record<string, unknown> | null;
}

/** The part of a CASL ability that the grant-scope checks read. */
export interface GrantScopeAbility {
  can(action: string, subject: string): boolean;
  rulesFor(action: string, subject: string): readonly GrantScopeRule[];
}

export interface GrantScopeItem {
  permissionId: string;
  actionName: string;
  subject: string;
  bodyConditions?: PermissionCondition | null;
}

export interface GrantScopeContext {
  actorId?: string;
  logger: ResolverLogger;
}

/** A refusal. `details` goes to the audit log, not to the response. */
export interface GrantRefusal {
  message: string;
  errorKey: ErrorKey;
  details: {
    action: string;
    subject: string;
    permissionId: string;
    reason?: string;
  };
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEquals(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    if (aKeys.length !== Object.keys(bObj).length) return false;
    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(bObj, key) &&
        deepEquals(aObj[key], bObj[key])
    );
  }

  return false;
}

/**
 * The set of values a predicate admits, when that set is knowable: a bare
 * scalar admits exactly itself, and a lone `$in` admits its elements. Any other
 * shape (a range, a negation, a nested object, `$in` mixed with another
 * operator) returns null, meaning "not expressible as a set" - the caller then
 * falls back to strict equality rather than guessing.
 */
function admittedValues(predicate: unknown): JsonScalar[] | null {
  if (isJsonScalar(predicate)) return [predicate];
  if (
    typeof predicate !== 'object' ||
    predicate === null ||
    Array.isArray(predicate)
  ) {
    return null;
  }
  const keys = Object.keys(predicate);
  if (keys.length !== 1 || keys[0] !== '$in') return null;
  const values = (predicate as { $in: unknown }).$in;
  if (!Array.isArray(values) || !values.every(isJsonScalar)) return null;
  return values;
}

/**
 * True when the grant's predicate on one field restricts at least as much as
 * the caller's own predicate on that field.
 *
 * Equality always qualifies. Beyond that, only the case both sides express as a
 * value set is decided: the grant qualifies when its set is a subset of the
 * caller's, which is what makes narrowing an existing predicate - `[true]` under
 * a caller holding `[true, false]` - the legitimate delegation it reads as.
 * Anything else falls back to equality.
 */
function predicateIsAtLeastAsNarrow(
  callerPredicate: unknown,
  grantPredicate: unknown
): boolean {
  if (deepEquals(callerPredicate, grantPredicate)) return true;

  const callerValues = admittedValues(callerPredicate);
  const grantValues = admittedValues(grantPredicate);
  if (callerValues === null || grantValues === null) return false;

  return grantValues.every((value) =>
    callerValues.some((allowed) => deepEquals(allowed, value))
  );
}

/**
 * True when every key of `callerQuery` appears in `grantQuery` under a
 * predicate that is at least as narrow. Extra keys in `grantQuery` are
 * additional restrictions and are allowed; a missing key, or one whose
 * predicate cannot be shown to be narrower, means the grant may reach rows the
 * caller cannot.
 *
 * This is a deliberately conservative approximation - deciding whether one
 * arbitrary MongoQuery is narrower than another is not decidable in general, so
 * whatever cannot be decided is rejected rather than assumed safe.
 */
function grantIsContained(
  callerQuery: Record<string, unknown>,
  grantQuery: Record<string, unknown>
): boolean {
  return Object.keys(callerQuery).every(
    (key) =>
      Object.prototype.hasOwnProperty.call(grantQuery, key) &&
      predicateIsAtLeastAsNarrow(callerQuery[key], grantQuery[key])
  );
}

function holdsDeny(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsDeny);
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { effect?: unknown }).effect === 'deny'
  );
}

/**
 * A row stored before the write-time `@IsObject()` check can hold an array.
 * A deny in any of its entries makes the row a deny, so the row fails closed.
 */
export function isDenyCondition(
  conditions: PermissionCondition | null | undefined
): boolean {
  return holdsDeny(conditions);
}

/**
 * Compares two stored or submitted conditions by value. A submitted condition
 * is a DTO instance that can carry keys set to `undefined`, which the jsonb
 * column never holds, so both sides are normalised through JSON first.
 */
export function sameConditions(
  a: PermissionCondition | null | undefined,
  b: PermissionCondition | null | undefined
): boolean {
  const normalise = (value: PermissionCondition | null | undefined): unknown =>
    JSON.parse(JSON.stringify(value ?? null)) as unknown;
  return deepEquals(normalise(a), normalise(b));
}

function refusal(
  item: GrantScopeItem,
  message: string,
  errorKey: ErrorKey,
  reason?: string
): GrantRefusal {
  return {
    message,
    errorKey,
    details: {
      action: item.actionName,
      subject: item.subject,
      permissionId: item.permissionId,
      ...(reason ? { reason } : {})
    }
  };
}

function grantItemRefusal(
  ability: GrantScopeAbility,
  item: GrantScopeItem,
  ctx: GrantScopeContext
): GrantRefusal | null {
  // A deny only narrows the reach of the holders, so adding one is never an
  // escalation, even on a pair the caller does not hold. Removing one is the
  // widening, and findLiftRefusal guards it.
  if (isDenyCondition(item.bodyConditions)) return null;

  const permissionLabel = `${item.actionName}:${item.subject}`;

  if (!ability.can(item.actionName, item.subject)) {
    return refusal(
      item,
      `Cannot grant ${permissionLabel} - caller lacks this permission`,
      ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION
    );
  }

  const allRules = ability.rulesFor(item.actionName, item.subject);

  // A caller under a deny can still act on the rows it leaves open, but an
  // allow they hand out carries no copy of that deny, so the grantee would
  // reach exactly the rows the caller is barred from.
  if (allRules.some((r) => r.inverted)) {
    return refusal(
      item,
      `Cannot grant ${permissionLabel} - caller holds it under a restriction`,
      ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION,
      'caller-restricted'
    );
  }

  const rules = allRules.filter((r) => !r.inverted);

  if (rules.some((r) => !r.conditions)) {
    return null;
  }

  if (!item.bodyConditions) {
    return refusal(
      item,
      `Cannot grant ${permissionLabel} unconditionally - caller holds it only with conditions`,
      ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION,
      'condition-escalation'
    );
  }

  if (!ctx.actorId) {
    // Every route reaching this check knows its user. Fail loudly rather than
    // skip the comparison, which would reopen the escalation this check
    // exists for.
    throw new Error('Cannot verify grant scope without the acting user id');
  }

  const resolved = resolveConditions(item.bodyConditions, {
    userId: ctx.actorId,
    permissionLabel,
    logger: ctx.logger
  });

  if (resolved.skipPermission) {
    // A vetoed condition restricts nothing at runtime, so treating it as
    // "conditions were supplied" would grant the permission unrestricted.
    return refusal(
      item,
      `Cannot grant ${permissionLabel} - the supplied condition cannot be applied as written`,
      ErrorKeys.ROLES.CONDITION_UNRESOLVABLE,
      'condition-unresolvable'
    );
  }

  const contained = rules.some(
    (r) => r.conditions && grantIsContained(r.conditions, resolved.query)
  );

  if (!contained) {
    return refusal(
      item,
      `Cannot grant ${permissionLabel} - the supplied condition is broader than the caller's own`,
      ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER,
      'condition-broader-than-caller'
    );
  }

  return null;
}

/**
 * "Can only grant what you have": for every permission being assigned to a
 * role, the caller's own ability must allow that action on that subject. If
 * the caller's matching allow rules are all conditional, the granted condition
 * must *contain* one of the caller's own conditions - an equal or stricter
 * condition is a legitimate narrower delegation, while a condition that drops
 * or changes any of the caller's own predicates would hand the grantee reach
 * the caller does not have.
 *
 * Both sides are compared after `resolveConditions`, because the body carries
 * the authored `PermissionCondition` while the caller's rules carry the
 * already-resolved MongoQuery. Resolving the body with the caller's own id is
 * what makes the two comparable.
 *
 * An item with a deny effect always passes: a deny can only narrow access.
 *
 * Returns the refusal of the first item that fails, or null. Callers with
 * `manage:all` (super) bypass all checks.
 */
export function findGrantRefusal(
  ability: GrantScopeAbility,
  items: GrantScopeItem[],
  ctx: GrantScopeContext
): GrantRefusal | null {
  if (ability.can('manage', 'all')) return null;

  for (const item of items) {
    const refused = grantItemRefusal(ability, item, ctx);
    if (refused) return refused;
  }
  return null;
}

/**
 * "Only an unrestricted holder may lift a restriction": removing a deny row -
 * directly, by omitting it from a full replace, by deleting its role, or by
 * taking its role away from a user - widens every holder's reach to the rows
 * the deny covered. A caller may do that only for an (action, subject) pair
 * they hold with an unconditional allow and no deny of their own; anything
 * narrower could lift a restriction that also binds them, or one wider than
 * their own reach. Items without a deny effect are ignored.
 *
 * Returns the refusal of the first item that fails, or null. Callers with
 * `manage:all` (super) bypass all checks.
 */
export function findLiftRefusal(
  ability: GrantScopeAbility,
  items: GrantScopeItem[]
): GrantRefusal | null {
  if (ability.can('manage', 'all')) return null;

  for (const item of items) {
    if (!isDenyCondition(item.bodyConditions)) continue;

    const rules = ability.rulesFor(item.actionName, item.subject);
    const unrestricted =
      rules.some((r) => !r.inverted && !r.conditions) &&
      !rules.some((r) => r.inverted);

    if (!unrestricted) {
      return refusal(
        item,
        `Cannot lift the ${item.actionName}:${item.subject} restriction - caller does not hold it without restriction`,
        ErrorKeys.ROLES.CANNOT_LIFT_DENY,
        'deny-lift'
      );
    }
  }
  return null;
}
