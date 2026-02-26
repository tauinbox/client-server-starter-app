import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditLog } from './entities/audit-log.entity';

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
      actorEmail: params.actorEmail ?? null,
      targetId: params.targetId ?? null,
      targetType: params.targetType ?? null,
      details: params.details ?? null,
      ipAddress: params.context?.ip ?? null,
      requestId: params.context?.requestId ?? null
    });
    await this.auditLogRepository.save(entry);
  }

  logFireAndForget(params: AuditLogParams): void {
    this.log(params).catch((err) => {
      this.logger.error('Failed to write audit log', err);
    });
  }
}
