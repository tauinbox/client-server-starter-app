import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { capAuditField } from '@app/shared/utils/audit-field';
import { MetricsService } from '../core/metrics/metrics.service';
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
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly metricsService: MetricsService
  ) {}

  /** With a manager, the row is written in the transaction of that manager. */
  async log(params: AuditLogParams, manager?: EntityManager): Promise<void> {
    const repository =
      manager?.getRepository(AuditLog) ?? this.auditLogRepository;
    const entry = repository.create({
      action: params.action,
      actorId: params.actorId ?? null,
      actorEmail: capAuditField(params.actorEmail),
      targetId: capAuditField(params.targetId),
      targetType: capAuditField(params.targetType),
      details: params.details ?? null,
      ipAddress: capAuditField(params.context?.ip),
      requestId: capAuditField(params.context?.requestId)
    });

    await repository.save(entry);
  }

  /** The row is lost on a fault, and the loss is counted. */
  logFireAndForget(params: AuditLogParams): void {
    this.log(params).catch((err) => {
      this.metricsService.recordAuditWriteFailure(params.action);
      this.logger.error('Failed to write audit log', err);
    });
  }
}
