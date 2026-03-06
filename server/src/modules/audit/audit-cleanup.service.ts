import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AuditLog } from './entities/audit-log.entity';

const DEFAULT_RETENTION_DAYS = 90;

@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger(AuditCleanupService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly configService: ConfigService
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyAuditLogCleanup(): Promise<void> {
    const retentionDays =
      this.configService.get<number>('AUDIT_LOG_RETENTION_DAYS') ??
      DEFAULT_RETENTION_DAYS;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      const result = await this.auditLogRepository.delete({
        createdAt: LessThan(cutoffDate)
      });
      this.logger.log(
        `Audit log cleanup: removed ${result.affected ?? 0} entries older than ${retentionDays} days`
      );
    } catch (error) {
      this.logger.error('Error during audit log cleanup', error);
    }
  }
}
