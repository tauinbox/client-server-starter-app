import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { capAuditField } from '@app/shared/utils/audit-field';
import { MetricsService } from '../core/metrics/metrics.service';
import { AuditLog } from './entities/audit-log.entity';
import type { SettingsWriteOutcome } from './entities/audit-log.entity';

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

function auditFields(params: AuditLogParams) {
  return {
    action: params.action,
    actorId: params.actorId ?? null,
    actorEmail: capAuditField(params.actorEmail),
    targetId: capAuditField(params.targetId),
    targetType: capAuditField(params.targetType),
    details: params.details ?? null,
    ipAddress: capAuditField(params.context?.ip),
    requestId: capAuditField(params.context?.requestId)
  };
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

    await repository.save(repository.create(auditFields(params)));
  }

  /**
   * Commits the row of a settings write before the write starts, so no
   * settings change exists without its row. Returns the id that the write
   * puts into its change log entries.
   */
  async openSettingsWrite(params: AuditLogParams): Promise<string> {
    const { id } = await this.auditLogRepository.save(
      this.auditLogRepository.create({
        ...auditFields(params),
        settingsOutcome: 'pending'
      })
    );

    return id;
  }

  /**
   * Records the outcome of a settings write. A failure is logged, not thrown:
   * the write has already committed or failed, and the row stays `pending`
   * until `SettingsWriteSettleService` reads the outcome from the change log.
   */
  async closeSettingsWrite(
    id: string,
    {
      outcome,
      params
    }: {
      outcome: Exclude<SettingsWriteOutcome, 'pending'>;
      params: AuditLogParams;
    }
  ): Promise<void> {
    const { details, ...fields } = auditFields(params);

    try {
      // `details` goes as a parameter: the typed `set` cannot take a jsonb
      // value of an open record type.
      await this.auditLogRepository
        .createQueryBuilder()
        .update(AuditLog)
        .set({ ...fields, settingsOutcome: outcome, details: () => ':details' })
        .setParameter('details', details && JSON.stringify(details))
        .where('id = :id', { id })
        .execute();
    } catch (err) {
      this.metricsService.recordAuditWriteFailure(params.action);
      this.logger.error('Failed to close a settings audit row', err);
    }
  }

  /**
   * Deletes the row of a settings write that was refused, because the refusal
   * changed nothing. A failure is logged, not thrown; the row then stays
   * `pending` until the settle job marks it `not_applied`.
   */
  async discardSettingsWrite(id: string): Promise<void> {
    try {
      await this.auditLogRepository.delete({
        id,
        settingsOutcome: 'pending'
      });
    } catch (err) {
      this.logger.error('Failed to discard a settings audit row', err);
    }
  }

  /** The row is lost on a fault, and the loss is counted. */
  logFireAndForget(params: AuditLogParams): void {
    this.log(params).catch((err) => {
      this.metricsService.recordAuditWriteFailure(params.action);
      this.logger.error('Failed to write audit log', err);
    });
  }
}
