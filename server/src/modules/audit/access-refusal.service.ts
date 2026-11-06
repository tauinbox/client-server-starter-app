import { type HttpException, Injectable } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ApiError } from '../../common/errors/api-error';
import type { AppAbility, Subjects } from '../auth/casl/app-ability';
import { auditContextOf } from '../auth/casl/ability-context';
import {
  MetricsService,
  type PermissionDenialLevel
} from '../core/metrics/metrics.service';
import { type AuditContext, AuditService } from './audit.service';

export interface AccessRefusal {
  /** A refused grant or widen writes `PERMISSION_GRANT_DENIED`. */
  auditAction?:
    AuditAction.PERMISSION_CHECK_FAILURE | AuditAction.PERMISSION_GRANT_DENIED;
  actorId?: string | null;
  targetId?: string | null;
  targetType?: string | null;
  details: Record<string, unknown>;
  context?: AuditContext;
  level: PermissionDenialLevel;
  /** One `rbac_permission_denied_total` increment for each pair. */
  denied: { action: string; subject: string }[];
}

export interface InstanceCheck {
  action: string;
  subject: Subjects;
  actorId?: string;
  targetId?: string;
  targetType?: string;
}

export interface SuperTargetCheck {
  action: 'update' | 'delete';
  target: { id: string; roles?: { isSuper: boolean }[] };
  actorId?: string;
}

@Injectable()
export class AccessRefusalService {
  constructor(
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService
  ) {}

  /**
   * The one exit of every authorization refusal: it writes the audit row with
   * the request context, counts the refusal, and throws the given exception.
   */
  refuse(refusal: AccessRefusal, exception: HttpException): never {
    this.auditService.logFireAndForget({
      action: refusal.auditAction ?? AuditAction.PERMISSION_CHECK_FAILURE,
      actorId: refusal.actorId ?? null,
      targetId: refusal.targetId ?? null,
      targetType: refusal.targetType ?? null,
      details: refusal.details,
      context: refusal.context
    });

    for (const { action, subject } of refusal.denied) {
      this.metricsService.recordPermissionDenied(
        refusal.level,
        action,
        subject
      );
    }

    throw exception;
  }

  /**
   * Assert that the ability allows the action on the subject.
   * On denial, refuses with level='instance'.
   */
  assertCan(ability: AppAbility, check: InstanceCheck): void {
    const { action, subject } = check;

    if (ability.can(action, subject)) {
      return;
    }

    const subjectName =
      typeof subject === 'string'
        ? subject
        : ((subject as { __caslSubjectType__?: string }).__caslSubjectType__ ??
          subject.constructor?.name ??
          'unknown');

    this.refuse(
      {
        actorId: check.actorId,
        targetId: check.targetId,
        targetType: check.targetType ?? subjectName,
        details: {
          instanceCheck: true,
          deniedAction: action,
          subject: subjectName
        },
        context: auditContextOf(ability),
        level: 'instance',
        denied: [{ action, subject: subjectName }]
      },
      new ApiError(
        ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS,
        'Insufficient permissions'
      )
    );
  }

  /**
   * An account that holds a super role is out of reach of every actor that is
   * not super itself. A delegated `update:User` would otherwise set its
   * password or end its sessions through a role change, and `delete:User`
   * would remove it: the super power that the role routes already refuse to
   * hand out.
   *
   * Runs after `assertCan`, and audits and counts a refusal the same way.
   */
  assertNotSuperTarget(ability: AppAbility, check: SuperTargetCheck): void {
    const { action, target, actorId } = check;

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

    this.refuse(
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
      new ApiError(
        ErrorKeys.USERS.SUPER_TARGET_FORBIDDEN,
        'Only a super actor can modify a super account'
      )
    );
  }
}
