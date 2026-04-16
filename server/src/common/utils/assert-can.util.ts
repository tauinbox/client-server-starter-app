import { ForbiddenException } from '@nestjs/common';
import type { AppAbility, Subjects } from '../../modules/auth/casl/app-ability';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';

interface AssertCanContext {
  actorId?: string;
  targetId?: string;
  targetType?: string;
}

/**
 * Assert that the ability allows the given action on the subject.
 * On denial, fires an audit log (fire-and-forget) and throws ForbiddenException.
 */
export function assertCan(
  ability: AppAbility,
  action: string,
  subject: Subjects,
  auditService: AuditService,
  context: AssertCanContext
): void {
  if (ability.can(action, subject)) {
    return;
  }

  const subjectName =
    typeof subject === 'string'
      ? subject
      : (subject.constructor?.name ?? 'unknown');

  auditService.logFireAndForget({
    action: AuditAction.PERMISSION_CHECK_FAILURE,
    actorId: context.actorId ?? null,
    targetId: context.targetId ?? null,
    targetType: context.targetType ?? subjectName,
    details: {
      instanceCheck: true,
      deniedAction: action,
      subject: subjectName
    }
  });

  throw new ForbiddenException('Insufficient permissions');
}
