import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import type { PermissionCondition } from '@app/shared/types';
import type { AppAbility, Subjects } from '../casl/app-ability';

export interface ResolvedGrantItem {
  permissionId: string;
  actionName: string;
  subject: string;
  bodyConditions?: PermissionCondition | null;
}

/**
 * Enforces "can only grant what you have": for every permission being
 * assigned to a role, the caller's own ability must allow that action on
 * that subject. If the caller's matching allow rules are all conditional,
 * the body must carry non-null conditions (blocks condition escalation).
 *
 * Callers with `manage:all` (super) bypass all checks.
 */
export function assertCanGrantPermissions(
  ability: AppAbility,
  items: ResolvedGrantItem[]
): void {
  if (ability.can('manage', 'all')) {
    return;
  }

  for (const item of items) {
    const subject = item.subject as Extract<Subjects, string>;

    if (!ability.can(item.actionName, subject)) {
      throw new HttpException(
        {
          message: `Cannot grant ${item.actionName}:${item.subject} — caller lacks this permission`,
          errorKey: ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION,
          details: {
            action: item.actionName,
            subject: item.subject,
            permissionId: item.permissionId
          }
        },
        HttpStatus.FORBIDDEN
      );
    }

    const rules = ability
      .rulesFor(item.actionName, subject)
      .filter((r) => !r.inverted);
    const hasUnconditional = rules.some((r) => !r.conditions);

    if (!hasUnconditional && !item.bodyConditions) {
      throw new HttpException(
        {
          message: `Cannot grant ${item.actionName}:${item.subject} unconditionally — caller holds it only with conditions`,
          errorKey: ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION,
          details: {
            action: item.actionName,
            subject: item.subject,
            permissionId: item.permissionId,
            reason: 'condition-escalation'
          }
        },
        HttpStatus.FORBIDDEN
      );
    }
  }
}
