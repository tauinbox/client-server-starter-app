import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import type { AppAbility } from '../../modules/auth/casl/app-ability';
import { auditContextOf } from '../../modules/auth/casl/ability-context';
import type { AuditService } from '../../modules/audit/audit.service';
import type { MetricsService } from '../../modules/core/metrics/metrics.service';
import { refuseAccess } from './refuse-access.util';

/**
 * An account that holds a super role is out of reach of every actor that is
 * not super itself. A delegated `update:User` would otherwise set its password
 * or end its sessions through a role change, and `delete:User` would remove it:
 * the super power that the role routes already refuse to hand out.
 *
 * Runs after `assertCan`, and audits and counts a refusal the same way.
 */
export function assertNotSuperTarget(
  ability: AppAbility,
  action: 'update' | 'delete',
  target: { id: string; roles?: { isSuper: boolean }[] },
  auditService: AuditService,
  actorId: string | undefined,
  metricsService: MetricsService
): void {
  if (ability.can('manage', 'all')) {
    return;
  }
  // Fail closed: a target loaded without its roles would pass as ordinary.
  if (!target.roles) {
    throw new Error('assertNotSuperTarget needs the roles of the target');
  }
  if (!target.roles.some((r) => r.isSuper)) {
    return;
  }

  refuseAccess(
    auditService,
    metricsService,
    {
      actorId,
      targetId: target.id,
      targetType: 'User',
      details: {
        instanceCheck: true,
        deniedAction: action,
        subject: 'User',
        superTarget: true
      },
      context: auditContextOf(ability),
      level: 'instance',
      denied: [{ action, subject: 'User' }]
    },
    new HttpException(
      {
        message: 'Only a super actor can modify a super account',
        errorKey: ErrorKeys.USERS.SUPER_TARGET_FORBIDDEN
      },
      HttpStatus.FORBIDDEN
    )
  );
}
