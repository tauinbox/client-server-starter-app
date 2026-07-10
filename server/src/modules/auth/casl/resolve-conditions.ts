import type { Logger } from '@nestjs/common';
import type { PermissionCondition } from '@app/shared/types';
import { findDeniedMongoKey } from '@app/shared/utils/mongo-query-safety';

/**
 * Runtime context for condition resolution. Carries the user identity used by
 * the ownership/userAttr branches and the permission label so warnings about
 * rejected input are actionable.
 */
export interface ResolverContext {
  userId: string;
  permissionLabel: string;
  logger: Logger;
}

/**
 * Translates a `PermissionCondition` into a single MongoQuery conditions object.
 *
 * Branches are merged in a fixed order — ownership → fieldMatch → userAttr →
 * custom — so when two branches write the same field key the later one wins.
 *
 * Returns `skipPermission: true` to veto the entire permission when the input
 * cannot be honored as authored: a denied MongoQuery operator in `custom`, or
 * restriction branches that resolve to an empty query (empty `fieldMatch`
 * arrays, unknown `userAttr` attributes, `custom` that parses to `{}` or not
 * at all). Registering such a permission unconditionally would silently widen
 * an intended restriction, so it fails closed instead. A condition object
 * with no restriction branches (only `effect`) is a legitimate unconditional
 * rule and is not vetoed.
 */
export function resolveConditions(
  conditions: PermissionCondition,
  ctx: ResolverContext
): { query: Record<string, unknown>; skipPermission: boolean } {
  const query: Record<string, unknown> = {};
  const { ownership, fieldMatch, userAttr, custom } = conditions;

  if (ownership !== undefined && ownership !== null) {
    query[ownership.userField] = ctx.userId;
  }

  if (fieldMatch !== undefined && fieldMatch !== null) {
    for (const [field, values] of Object.entries(fieldMatch)) {
      if (Array.isArray(values) && values.length > 0) {
        query[field] = { $in: values };
      }
    }
  }

  if (userAttr !== undefined && userAttr !== null) {
    // userContext can be extended as more user attributes become available.
    const userContext: Record<string, unknown> = { id: ctx.userId };
    for (const [field, attrName] of Object.entries(userAttr)) {
      if (typeof attrName === 'string' && attrName in userContext) {
        query[field] = userContext[attrName];
      } else {
        ctx.logger.warn(
          `userAttr references unknown attribute "${String(attrName)}" for user ${ctx.userId} — skipping field "${field}"`
        );
      }
    }
  }

  if (custom !== undefined && custom !== null) {
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(custom) as Record<string, unknown>;
    } catch {
      ctx.logger.warn(
        `Invalid JSON in custom condition for user ${ctx.userId}: "${custom}" — skipping`
      );
    }

    if (parsed !== undefined) {
      const denied = findDeniedMongoKey(parsed);
      if (denied) {
        ctx.logger.warn(
          `Denied operator "${denied}" in custom condition for user ${ctx.userId}, permission "${ctx.permissionLabel}" — skipping entire permission`
        );
        return { query, skipPermission: true };
      }
      Object.assign(query, parsed);
    }
  }

  const hasRestrictionBranches =
    (ownership !== undefined && ownership !== null) ||
    (fieldMatch !== undefined && fieldMatch !== null) ||
    (userAttr !== undefined && userAttr !== null) ||
    (custom !== undefined && custom !== null);

  if (hasRestrictionBranches && Object.keys(query).length === 0) {
    ctx.logger.warn(
      `Conditions of permission "${ctx.permissionLabel}" resolved to an empty query for user ${ctx.userId} - failing closed, vetoing permission`
    );
    return { query, skipPermission: true };
  }

  return { query, skipPermission: false };
}
