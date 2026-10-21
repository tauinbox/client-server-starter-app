import { ForbiddenException } from '@nestjs/common';
import type { AppAbility, Subjects } from '../../modules/auth/casl/app-ability';
import { auditContextOf } from '../../modules/auth/casl/ability-context';
import { AuditService } from '../../modules/audit/audit.service';
import { ErrorKeys } from '@app/shared/constants';
import type { MetricsService } from '../../modules/core/metrics/metrics.service';
import { refuseAccess } from './refuse-access.util';

interface AssertCanContext {
  actorId?: string;
  targetId?: string;
  targetType?: string;
}

/**
 * Assert that the ability allows the given action on the subject.
 * On denial, refuses through `refuseAccess` with level='instance'.
 */
export function assertCan(
  ability: AppAbility,
  action: string,
  subject: Subjects,
  auditService: AuditService,
  context: AssertCanContext,
  metricsService: MetricsService
): void {
  if (ability.can(action, subject)) {
    return;
  }

  const subjectName =
    typeof subject === 'string'
      ? subject
      : ((subject as { __caslSubjectType__?: string }).__caslSubjectType__ ??
        subject.constructor?.name ??
        'unknown');

  refuseAccess(
    auditService,
    metricsService,
    {
      actorId: context.actorId,
      targetId: context.targetId,
      targetType: context.targetType ?? subjectName,
      details: {
        instanceCheck: true,
        deniedAction: action,
        subject: subjectName
      },
      context: auditContextOf(ability),
      level: 'instance',
      denied: [{ action, subject: subjectName }]
    },
    new ForbiddenException({
      message: 'Insufficient permissions',
      errorKey: ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS
    })
  );
}
