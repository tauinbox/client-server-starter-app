import {
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  type Logger
} from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import type { PermissionCondition } from '@app/shared/types';
import type { AppAbility, Subjects } from '../casl/app-ability';
import { resolveConditions } from '../casl/resolve-conditions';

export interface ResolvedGrantItem {
  permissionId: string;
  actionName: string;
  subject: string;
  bodyConditions?: PermissionCondition | null;
}

export interface GrantCheckContext {
  actorId?: string;
  logger: Logger;
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
 * True when every key of `callerQuery` appears in `grantQuery` with an equal
 * value. Extra keys in `grantQuery` are additional restrictions and are
 * allowed; a missing or differing key means the grant reaches rows the caller
 * cannot reach.
 *
 * This is a deliberately conservative approximation - deciding whether one
 * arbitrary MongoQuery is narrower than another is not decidable in general,
 * so anything that is not a plain superset is rejected.
 */
function grantIsContained(
  callerQuery: Record<string, unknown>,
  grantQuery: Record<string, unknown>
): boolean {
  return Object.keys(callerQuery).every(
    (key) =>
      Object.prototype.hasOwnProperty.call(grantQuery, key) &&
      deepEquals(callerQuery[key], grantQuery[key])
  );
}

function grantDenied(
  item: ResolvedGrantItem,
  message: string,
  errorKey: string,
  reason?: string
): HttpException {
  return new HttpException(
    {
      message,
      errorKey,
      details: {
        action: item.actionName,
        subject: item.subject,
        permissionId: item.permissionId,
        ...(reason ? { reason } : {})
      }
    },
    HttpStatus.FORBIDDEN
  );
}

/**
 * Enforces "can only grant what you have": for every permission being
 * assigned to a role, the caller's own ability must allow that action on
 * that subject. If the caller's matching allow rules are all conditional,
 * the granted condition must *contain* one of the caller's own conditions -
 * an equal or stricter condition is a legitimate narrower delegation, while a
 * condition that drops or changes any of the caller's own predicates would
 * hand the grantee reach the caller does not have.
 *
 * Both sides are compared after `resolveConditions`, because the body carries
 * the authored `PermissionCondition` while the caller's rules carry the
 * already-resolved MongoQuery. Resolving the body with the caller's own id is
 * what makes the two comparable.
 *
 * Callers with `manage:all` (super) bypass all checks.
 */
export function assertCanGrantPermissions(
  ability: AppAbility,
  items: ResolvedGrantItem[],
  ctx: GrantCheckContext
): void {
  if (ability.can('manage', 'all')) {
    return;
  }

  for (const item of items) {
    const subject = item.subject as Extract<Subjects, string>;

    if (!ability.can(item.actionName, subject)) {
      throw grantDenied(
        item,
        `Cannot grant ${item.actionName}:${item.subject} - caller lacks this permission`,
        ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION
      );
    }

    const rules = ability
      .rulesFor(item.actionName, subject)
      .filter((r) => !r.inverted);

    if (rules.some((r) => !r.conditions)) {
      continue;
    }

    if (!item.bodyConditions) {
      throw grantDenied(
        item,
        `Cannot grant ${item.actionName}:${item.subject} unconditionally - caller holds it only with conditions`,
        ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION,
        'condition-escalation'
      );
    }

    if (!ctx.actorId) {
      // Every route reaching this check runs behind @Authorize, which cannot
      // produce a request without a user id. Fail loudly rather than skip the
      // comparison, which would reopen the escalation this check exists for.
      throw new InternalServerErrorException(
        'Cannot verify grant scope without the acting user id'
      );
    }

    const permissionLabel = `${item.actionName}:${item.subject}`;
    const resolved = resolveConditions(item.bodyConditions, {
      userId: ctx.actorId,
      permissionLabel,
      logger: ctx.logger
    });

    if (resolved.skipPermission) {
      // A vetoed condition restricts nothing at runtime, so treating it as
      // "conditions were supplied" would grant the permission unrestricted.
      throw grantDenied(
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
      throw grantDenied(
        item,
        `Cannot grant ${permissionLabel} - the supplied condition is broader than the caller's own`,
        ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER,
        'condition-broader-than-caller'
      );
    }
  }
}
