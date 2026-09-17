import type { Request, Response } from 'express';
import { ErrorKeys } from '@app/shared/constants';
import type { PermissionCondition } from '@app/shared/types';
import {
  buildAbilityForUser,
  getState,
  logAudit,
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

const isDeny = (conditions: PermissionCondition | null | undefined): boolean =>
  conditions?.effect === 'deny';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries.map(([k, v]) => [k, canonical(v)]));
}

/** Value equality that ignores key order, as a jsonb comparison does. */
export function sameConditions(
  a: PermissionCondition | null | undefined,
  b: PermissionCondition | null | undefined
): boolean {
  return (
    JSON.stringify(canonical(a ?? null)) ===
    JSON.stringify(canonical(b ?? null))
  );
}

function refusal(
  ability: MockAbility,
  item: ScopeItem,
  check: ScopeCheck
): { body: Record<string, unknown>; details: Record<string, unknown> } | null {
  const state = getState();
  const permission = state.permissions.get(item.permissionId);
  if (!permission) return null;
  const action = state.actions.get(permission.actionId)?.name;
  const subject = state.resources.get(permission.resourceId)?.subject;
  if (!action || !subject) return null;

  const rules = ability.rulesFor(action as Actions, subject as SubjectNames);
  const restricted = rules.some((r) => r.inverted);
  const details = { action, subject, permissionId: item.permissionId };

  if (check === 'grant') {
    if (isDeny(item.conditions) || !restricted) return null;
    return {
      body: {
        message: `Cannot grant ${action}:${subject} - caller holds it under a restriction`,
        statusCode: 403,
        errorKey: ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION
      },
      details: { ...details, reason: 'caller-restricted' }
    };
  }

  if (!isDeny(item.conditions)) return null;
  const unconditional = rules.some((r) => !r.inverted && !r.conditions);
  if (unconditional && !restricted) return null;
  return {
    body: {
      message: `Cannot lift the ${action}:${subject} restriction - caller does not hold it without restriction`,
      statusCode: 403,
      errorKey: ErrorKeys.ROLES.CANNOT_LIFT_DENY
    },
    details: { ...details, reason: 'deny-lift' }
  };
}

/**
 * Mirrors the deny part of the server grant-scope check: a caller under a deny
 * cannot grant an allow on that pair, and only a caller holding the pair
 * without restriction can remove a deny row. The server's condition
 * containment is not mirrored. Answers 403, audits the refusal like
 * `RoleService` does, and returns false when the write must stop.
 */
export function assertDenyScope(
  req: Request,
  res: Response,
  check: ScopeCheck,
  roleId: string,
  items: ScopeItem[]
): boolean {
  const { user } = req as AuthenticatedRequest;
  const ability = buildAbilityForUser(user);
  if (ability.can('manage', 'all')) return true;

  for (const item of items) {
    const refused = refusal(ability, item, check);
    if (!refused) continue;
    logAudit('PERMISSION_GRANT_DENIED', {
      actorId: user.id,
      targetId: roleId,
      targetType: 'Role',
      // The server audits the details; its exception filter keeps them out
      // of the response body.
      details: refused.details
    });
    res.status(403).json(refused.body);
    return false;
  }
  return true;
}

/** The deny rows a role holds today. */
export function denyRowsOf(roleId: string): ScopeItem[] {
  return getState().rolePermissions.filter(
    (rp) => rp.roleId === roleId && isDeny(rp.conditions)
  );
}
