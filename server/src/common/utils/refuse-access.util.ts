import type { HttpException } from '@nestjs/common';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import type {
  AuditContext,
  AuditService
} from '../../modules/audit/audit.service';
import type {
  MetricsService,
  PermissionDenialLevel
} from '../../modules/core/metrics/metrics.service';

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

/**
 * The one exit of every authorization refusal: it writes the audit row with
 * the request context, counts the refusal, and throws the given exception.
 */
export function refuseAccess(
  auditService: AuditService,
  metricsService: MetricsService,
  refusal: AccessRefusal,
  exception: HttpException
): never {
  auditService.logFireAndForget({
    action: refusal.auditAction ?? AuditAction.PERMISSION_CHECK_FAILURE,
    actorId: refusal.actorId ?? null,
    targetId: refusal.targetId ?? null,
    targetType: refusal.targetType ?? null,
    details: refusal.details,
    context: refusal.context
  });
  for (const { action, subject } of refusal.denied) {
    metricsService.recordPermissionDenied(refusal.level, action, subject);
  }
  throw exception;
}
