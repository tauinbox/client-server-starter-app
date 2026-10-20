import {
  CASL_RESERVED_ACTION_NAMES,
  CASL_RESERVED_SUBJECT_NAMES
} from '../constants/permission.constants';
import type { SubjectMaps } from '../types/rbac.types';
import type {
  PermissionCondition,
  ResolvedPermission
} from '../types/role.types';
import {
  findConditionFieldError,
  findConditionSupportError
} from './permission-condition-shape';
import { resolveConditions, type ResolverLogger } from './resolve-conditions';

export interface AbilityLogger extends ResolverLogger {
  error(message: string): void;
}

/** A CASL raw rule. Each workspace passes the list to `createMongoAbility`. */
export interface AbilityRule<
  A extends string = string,
  S extends string = string
> {
  action: A;
  subject: S;
  conditions?: Record<string, unknown>;
  inverted?: true;
}

/** One `role_permissions` row of one role of the user, in role order. */
export interface GrantRow {
  resource: string;
  action: string;
  conditions: PermissionCondition | null;
}

/**
 * The permissions of a user, one per distinct grant, first wins.
 *
 * Conditions are part of the key: two restriction roles on one permission are
 * two denies, and dropping either widens the grant. jsonb key order is stable,
 * so equal conditions still dedup.
 */
export function dedupPermissions(
  grants: Iterable<GrantRow>
): ResolvedPermission[] {
  const permissionMap = new Map<string, ResolvedPermission>();
  for (const { resource, action, conditions } of grants) {
    const effect = conditions?.effect === 'deny' ? 'deny' : 'allow';
    const key = `${effect}:${resource}:${action}:${JSON.stringify(conditions ?? null)}`;
    if (!permissionMap.has(key)) {
      permissionMap.set(key, {
        resource,
        action,
        permission: `${resource}:${action}`,
        conditions
      });
    }
  }
  return Array.from(permissionMap.values());
}

/**
 * Compiles the CASL rules of a user from already-loaded permissions and
 * resource maps. The server and the mock build their ability from this list.
 *
 * `A` and `S` only narrow the result type to the ability of the caller: the
 * names come from stored rows, so the compiler cannot prove them.
 */
export function compileAbilityRules<
  A extends string = string,
  S extends string = string
>(
  userId: string,
  isSuper: boolean,
  permissions: ResolvedPermission[],
  subjectMaps: SubjectMaps,
  logger: AbilityLogger
): AbilityRule<A, S>[] {
  if (isSuper) {
    return [{ action: 'manage' as A, subject: 'all' as S }];
  }

  const rules: AbilityRule<A, S>[] = [];

  // CASL evaluates rules in order; inverted rules (cannot) must come after
  // direct rules (can) to override them. Partition so allows are registered
  // first, denies last.
  const ordered = [
    ...permissions.filter((p) => p.conditions?.effect !== 'deny'),
    ...permissions.filter((p) => p.conditions?.effect === 'deny')
  ];

  for (const p of ordered) {
    const action = p.action;
    const isDeny = p.conditions?.effect === 'deny';

    // Fail closed in both directions, as the condition veto below does: an
    // allow needs a live resource, while a deny must outlive its resource
    // going orphaned rather than vanish with it.
    const subject = isDeny
      ? (subjectMaps.active[p.resource] ?? subjectMaps.orphaned[p.resource])
      : subjectMaps.active[p.resource];

    if (!subject) {
      if (isDeny) {
        logger.error(
          `Deny permission "${p.permission}" for user ${userId} names unknown resource "${p.resource}" - the deny cannot be registered`
        );
      } else {
        logger.warn(
          `Unknown resource "${p.resource}" in permissions for user ${userId} — skipping`
        );
      }
      continue;
    }

    const register = (conditions?: Record<string, unknown>): void => {
      rules.push({
        action: action as A,
        subject: subject as S,
        ...(conditions ? { conditions } : {}),
        ...(isDeny ? { inverted: true } : {})
      });
    };

    // A reserved keyword reaching here bypassed the write-time checks, and
    // can('manage', X) / can(X, 'all') grant far beyond what the permission
    // names. The deny stays registered - inverting a wildcard is strictly
    // more restrictive, and dropping an authored deny would fail open.
    if (
      CASL_RESERVED_ACTION_NAMES.includes(action) ||
      CASL_RESERVED_SUBJECT_NAMES.includes(subject.toLowerCase())
    ) {
      logger.error(
        `Permission "${p.permission}" for user ${userId} uses a reserved CASL keyword (action "${action}", subject "${subject}") - ${
          isDeny ? 'registered as a blanket deny' : 'not registered'
        }`
      );
      if (isDeny) {
        register();
      }
      continue;
    }

    // An allow on an action the resource does not offer is invisible in the
    // permission matrix, so it must grant nothing.
    if (
      !isDeny &&
      !subjectMaps.grantableActions[p.resource]?.includes(action)
    ) {
      continue;
    }

    if (!p.conditions) {
      register();
      continue;
    }

    // The route check of this action ignores conditions (CASL answers a
    // subject-type check from the rule alone), so a restriction here would
    // pass as a full grant. Fail closed as for an unusable condition: the
    // allow grants nothing, the deny denies everything.
    if (
      findConditionSupportError(
        action,
        subjectMaps.conditionalActions[p.resource] ?? [],
        p.conditions
      )
    ) {
      logger.error(
        `Permission "${p.permission}" for user ${userId} carries a condition that no check of "${action}" on "${subject}" reads - ${
          isDeny ? 'registered as a blanket deny' : 'not registered'
        }`
      );
      if (isDeny) {
        register();
      }
      continue;
    }

    const queryResult = resolveConditions(p.conditions, {
      userId,
      permissionLabel: p.permission,
      logger
    });

    // A field off the allow-list is a typo that matches nothing or a column
    // that no response sends.
    const fieldError = queryResult.skipPermission
      ? null
      : findConditionFieldError(subject, p.conditions);
    if (fieldError) {
      logger.error(
        `Permission "${p.permission}" for user ${userId} carries a condition on "${subject}" that cannot apply (${fieldError}) - ${
          isDeny ? 'registered as a blanket deny' : 'not registered'
        }`
      );
    }

    if (queryResult.skipPermission || fieldError) {
      // Fail closed in both directions: a vetoed allow grants nothing,
      // while a vetoed deny must still deny everything rather than vanish.
      if (isDeny) {
        register();
      }
      continue;
    }

    // Empty query here means the condition object carried no restriction
    // branches at all (e.g. only `effect`) - an unconditional rule.
    register(
      Object.keys(queryResult.query).length > 0 ? queryResult.query : undefined
    );
  }

  return rules;
}
