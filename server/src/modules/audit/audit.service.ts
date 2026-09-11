import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditLog } from './entities/audit-log.entity';

/**
 * Matches the varchar(255) TypeORM gives User.email. The audit columns are
 * unbounded varchar, so an over-long actor email or request id would be stored
 * as sent. Every string field is capped here, not at the call sites, because
 * some of them carry values the caller never validated (a login email reaches
 * the row without a DTO, and req.ip is resolved from a proxy header).
 */
export const AUDIT_FIELD_MAX_LENGTH = 255;

function capAuditField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.length > AUDIT_FIELD_MAX_LENGTH
    ? value.slice(0, AUDIT_FIELD_MAX_LENGTH)
    : value;
}

export interface AuditContext {
  ip?: string;
  requestId?: string;
}

export interface AuditLogParams {
  action: AuditAction;
  actorId?: string | null;
  actorEmail?: string | null;
  targetId?: string | null;
  targetType?: string | null;
  details?: Record<string, unknown> | null;
  context?: AuditContext;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>
  ) {}

  async log(params: AuditLogParams): Promise<void> {
    const entry = this.auditLogRepository.create({
      action: params.action,
      actorId: params.actorId ?? null,
      actorEmail: capAuditField(params.actorEmail),
      targetId: capAuditField(params.targetId),
      targetType: capAuditField(params.targetType),
      details: params.details ?? null,
      ipAddress: capAuditField(params.context?.ip),
      requestId: capAuditField(params.context?.requestId)
    });
    await this.auditLogRepository.save(entry);
  }

  logFireAndForget(params: AuditLogParams): void {
    this.log(params).catch((err) => {
      this.logger.error('Failed to write audit log', err);
    });
  }
}
