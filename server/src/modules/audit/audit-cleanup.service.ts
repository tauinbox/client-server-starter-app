import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import {
  POOL_LOCK_KEYS,
  runOncePerPool
} from '../../common/utils/pool-lock.util';
import { AuditLog } from './entities/audit-log.entity';

const DEFAULT_RETENTION_DAYS = 90;

@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger(AuditCleanupService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  async handleDailyAuditLogCleanup(): Promise<void> {
    try {
      await runOncePerPool(
        this.dataSource,
        POOL_LOCK_KEYS.auditLogCleanup,
        () => this.deleteExpiredEntries()
      );
    } catch (error) {
      this.logger.error('Error during audit log cleanup', error);
    }
  }

  private async deleteExpiredEntries(): Promise<void> {
    const retentionDays =
      this.configService.get<number>('AUDIT_LOG_RETENTION_DAYS') ??
      DEFAULT_RETENTION_DAYS;

    const cutoffDate = new Date();

    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.auditLogRepository.delete({
      createdAt: LessThan(cutoffDate)
    });

    this.logger.log(
      `Audit log cleanup: removed ${result.affected ?? 0} entries older than ${retentionDays} days`
    );
  }
}
