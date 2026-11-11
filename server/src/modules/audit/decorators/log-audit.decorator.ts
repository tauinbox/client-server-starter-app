import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { AuditAction } from '@app/shared/enums/audit-action.enum';

export const LOG_AUDIT_KEY = 'log_audit';

export interface LogAuditDetailsContext {
  request: Request;
  response: unknown;
  params: Record<string, string>;
  body: unknown;
}

export interface LogAuditOptions {
  /** Audit action enum value */
  action: AuditAction;
  /** Target type label (e.g. 'User', 'Role') */
  targetType: string;
  /** Route param name to read targetId from. Defaults to `'id'`. */
  targetIdParam?: string;
  /**
   * Build the `details` object from the request/response context.
   * Return `undefined` to omit details.
   */
  details?: (
    ctx: LogAuditDetailsContext
  ) => Record<string, unknown> | undefined;
}

/**
 * Marks a controller handler for automatic audit logging by `AuditLogInterceptor`.
 * The audit entry is written after the handler returns successfully (fire-and-forget).
 * Errors are not audited.
 */
export const LogAudit = (options: LogAuditOptions) =>
  SetMetadata(LOG_AUDIT_KEY, options);
