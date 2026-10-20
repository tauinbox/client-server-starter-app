import type { Request, Response } from 'express';
import { ErrorKeys } from '@app/shared/constants';
import type { PermissionCondition } from '@app/shared/types';
import {
  findGrantRefusal,
  findLiftRefusal,
  isDenyCondition,
  type GrantScopeAbility,
  type GrantScopeItem
} from '@app/shared/utils/grant-scope';
import {
  buildAbilityForUser,
  getState,
  logAudit,
  SILENT_RESOLVER_LOGGER,
  type Actions,
  type MockAbility,
  type SubjectNames
} from '../state';
import type { AuthenticatedRequest } from '../types';

type ScopeItem = {
  permissionId: string;
  conditions?: PermissionCondition | null;
};

type ScopeCheck = 'grant' | 'lift';

// A grant names its subject by the string stored on the resource row.
function scopeOf(ability: MockAbility): GrantScopeAbility {
  return {
    can: (action, subject) =>
      ability.can(action as Actions, subject as SubjectNames),
    rulesFor: (action, subject) =>
      ability.rulesFor(action as Actions, subject as SubjectNames)
  };
}

/** Resolves the action and subject names, as `RoleService` does. */
function toGrantItems(items: ScopeItem[]): GrantScopeItem[] {
  const state = getState();
  return items.flatMap((item) => {
    const permission = state.permissions.get(item.permissionId);
    if (!permission) return [];
    const actionName = state.actions.get(permission.actionId)?.name;
    const subject = state.resources.get(permission.resourceId)?.subject;
    if (!actionName || !subject) return [];
    return [
      {
        permissionId: item.permissionId,
        actionName,
        subject,
        bodyConditions: item.conditions ?? null
      }
    ];
  });
}

/**
 * Applies the server grant-scope check: a caller can grant only a pair it
 * holds, not under a deny, and with a condition at least as narrow as its
 * own; only a caller holding the pair without restriction can remove a deny
 * row. Answers 403, audits the refusal like `RoleService` does, and returns
 * false when the write must stop.
 */
export function assertGrantScope(
  req: Request,
  res: Response,
  check: ScopeCheck,
  roleId: string,
  items: ScopeItem[]
): boolean {
  const { user } = req as AuthenticatedRequest;
  const ability = scopeOf(buildAbilityForUser(user));
  const grantItems = toGrantItems(items);
  const refused =
    check === 'grant'
      ? findGrantRefusal(ability, grantItems, {
          actorId: user.id,
          logger: SILENT_RESOLVER_LOGGER
        })
      : findLiftRefusal(ability, grantItems);
  if (!refused) return true;

  logAudit('PERMISSION_GRANT_DENIED', {
    actorId: user.id,
    targetId: roleId,
    targetType: 'Role',
    // The server audits the details; its exception filter keeps them out
    // of the response body.
    details: refused.details
  });
  res.status(refused.status).json({
    message: refused.message,
    statusCode: refused.status,
    errorKey: refused.errorKey
  });
  return false;
}

/**
 * Mirrors `ResourceService.assertCanWiden`: offering a narrowed or orphaned
 * action again wakes its dormant grants, so only a super caller may. Answers
 * 403, audits the refusal, and returns false when the write must stop.
 */
export function assertCanWiden(
  req: Request,
  res: Response,
  resource: { id: string; name: string; subject: string },
  reEnabled: string[]
): boolean {
  if (reEnabled.length === 0) return true;
  const { user } = req as AuthenticatedRequest;
  if (buildAbilityForUser(user).can('manage', 'all')) return true;
  logAudit('PERMISSION_GRANT_DENIED', {
    actorId: user.id,
    targetId: resource.id,
    targetType: 'Resource',
    details: {
      subject: resource.subject,
      actions: reEnabled,
      reason: 'resource-widen'
    }
  });
  res.status(403).json({
    message: `Only a super administrator can offer the actions ${reEnabled.join(', ')} of resource "${resource.name}" again`,
    statusCode: 403,
    errorKey: ErrorKeys.RESOURCES.CANNOT_WIDEN
  });
  return false;
}

/** The deny rows a role holds today. */
export function denyRowsOf(roleId: string): ScopeItem[] {
  return getState().rolePermissions.filter(
    (rp) => rp.roleId === roleId && isDenyCondition(rp.conditions)
  );
}
