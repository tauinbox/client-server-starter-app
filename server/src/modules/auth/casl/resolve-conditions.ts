import type { Logger } from '@nestjs/common';
import type { PermissionCondition } from '@app/shared/types';
import { findDeniedMongoKey } from '@app/shared/utils/mongo-query-safety';
import {
  findFieldMatchShapeError,
  findOwnershipShapeError,
  findUserAttrShapeError
} from '@app/shared/utils/permission-condition-shape';

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
 * custom — so when two branches write the same field key the later one wins,
 * with one exception: the `ownership` key is protected. A later branch that
 * writes `ownership.userField` would silently replace the owner-scoping
 * predicate with a broader one, so such a collision vetoes the permission.
 *
 * Returns `skipPermission: true` to veto the entire permission when the input
 * cannot be honored as authored: a branch whose shape is malformed (validated
 * by the shared shape finders the DTO also uses), an unknown `userAttr`
 * attribute, invalid/non-object/denied-operator `custom`, or restriction
 * branches that resolve to an empty query. Dropping just the malformed part
 * would silently widen an intended restriction (and make a deny vanish), so
 * any unusable fragment fails the whole permission closed. A condition object
 * with no restriction branches (only `effect`) is a legitimate unconditional
 * rule and is not vetoed.
 */
export function resolveConditions(
  conditions: PermissionCondition,
  ctx: ResolverContext
): { query: Record<string, unknown>; skipPermission: boolean } {
  const query: Record<string, unknown> = {};
  const { ownership, fieldMatch, userAttr, custom } = conditions;

  const veto = (
    reason: string
  ): { query: Record<string, unknown>; skipPermission: boolean } => {
    ctx.logger.warn(
      `Conditions of permission "${ctx.permissionLabel}" cannot be honored as authored for user ${ctx.userId} (${reason}) - failing closed, vetoing permission`
    );
    return { query, skipPermission: true };
  };

  let ownershipField: string | undefined;
  if (ownership !== undefined && ownership !== null) {
    const shapeError = findOwnershipShapeError(ownership);
    if (shapeError) {
      return veto(shapeError);
    }
    ownershipField = ownership.userField;
    query[ownershipField] = ctx.userId;
  }

  if (fieldMatch !== undefined && fieldMatch !== null) {
    const shapeError = findFieldMatchShapeError(fieldMatch);
    if (shapeError) {
      return veto(shapeError);
    }
    for (const [field, values] of Object.entries(fieldMatch)) {
      if (field === ownershipField) {
        return veto(
          `fieldMatch key "${field}" collides with ownership.userField`
        );
      }
      query[field] = { $in: values };
    }
  }

  if (userAttr !== undefined && userAttr !== null) {
    const shapeError = findUserAttrShapeError(userAttr);
    if (shapeError) {
      return veto(shapeError);
    }
    // userContext can be extended as more user attributes become available.
    const userContext: Record<string, unknown> = { id: ctx.userId };
    for (const [field, attrName] of Object.entries(userAttr)) {
      const attr = attrName as string;
      if (!Object.prototype.hasOwnProperty.call(userContext, attr)) {
        return veto(
          `userAttr references unknown attribute "${attr}" in field "${field}"`
        );
      }
      if (field === ownershipField) {
        return veto(
          `userAttr key "${field}" collides with ownership.userField`
        );
      }
      query[field] = userContext[attr];
    }
  }

  if (custom !== undefined && custom !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(custom);
    } catch {
      return veto(`invalid JSON in custom condition: "${custom}"`);
    }

    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return veto('custom condition is not a JSON object');
    }

    const denied = findDeniedMongoKey(parsed);
    if (denied) {
      return veto(`denied operator "${denied}" in custom condition`);
    }
    if (
      ownershipField !== undefined &&
      Object.prototype.hasOwnProperty.call(parsed, ownershipField)
    ) {
      return veto(
        `custom condition key "${ownershipField}" collides with ownership.userField`
      );
    }
    Object.assign(query, parsed);
  }

  const hasRestrictionBranches =
    (ownership !== undefined && ownership !== null) ||
    (fieldMatch !== undefined && fieldMatch !== null) ||
    (userAttr !== undefined && userAttr !== null) ||
    (custom !== undefined && custom !== null);

  if (hasRestrictionBranches && Object.keys(query).length === 0) {
    return veto('resolved to an empty query');
  }

  return { query, skipPermission: false };
}
