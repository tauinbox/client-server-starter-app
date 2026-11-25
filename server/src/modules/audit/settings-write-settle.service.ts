import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SETTINGS_DATA_SOURCE } from '../../data-sources';
import {
  POOL_LOCK_KEYS,
  runOncePerPool
} from '../../common/utils/pool-lock.util';

/**
 * A settings write that waits longer than this is not expected; a row of a
 * write that commits later is set to `applied` by that write itself.
 */
export const SETTINGS_WRITE_SETTLE_AFTER_MINUTES = 10;
/** The name of the settle job in the `SchedulerRegistry`. */
export const SETTINGS_WRITE_SETTLE_CRON_NAME = 'settings-write-settle';
const SETTLE_BATCH = 500;

/**
 * Settles the audit rows that a stopped node left `pending`: a row whose id is
 * in an entry of the settings change log is `applied`, any other row is
 * `not_applied`. The audit rows and the change log go to two databases after
 * the split, so the two reads are separate queries.
 */
@Injectable()
export class SettingsWriteSettleService {
  private readonly logger = new Logger(SettingsWriteSettleService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectDataSource(SETTINGS_DATA_SOURCE)
    private readonly settingsDataSource: DataSource
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: SETTINGS_WRITE_SETTLE_CRON_NAME })
  async handleSettle(): Promise<void> {
    try {
      await runOncePerPool(
        this.dataSource,
        POOL_LOCK_KEYS.settingsWriteSettle,
        () => this.settle()
      );
    } catch (error) {
      this.logger.error('Error while settling settings audit rows', error);
    }
  }

  async settle(): Promise<void> {
    const pending = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "audit_logs"
       WHERE "settings_outcome" = 'pending'
         AND "created_at" < now() - make_interval(mins => $1)
       ORDER BY "created_at" LIMIT $2`,
      [SETTINGS_WRITE_SETTLE_AFTER_MINUTES, SETTLE_BATCH]
    );

    if (pending.length === 0) return;

    const ids = pending.map(({ id }) => id);
    const logged = await this.settingsDataSource.query<
      Array<{ audit_id: string }>
    >(
      `SELECT DISTINCT "audit_id" FROM "settings_change_log"
       WHERE "audit_id" = ANY($1::uuid[])`,
      [ids]
    );
    const applied = logged.map(({ audit_id: id }) => id);
    const notApplied = ids.filter((id) => !applied.includes(id));

    for (const [outcome, group] of [
      ['applied', applied],
      ['not_applied', notApplied]
    ] as const) {
      if (group.length === 0) continue;

      await this.dataSource.query(
        `UPDATE "audit_logs" SET "settings_outcome" = $1
         WHERE "id" = ANY($2::uuid[]) AND "settings_outcome" = 'pending'`,
        [outcome, group]
      );
    }

    this.logger.warn(
      `Settled ${ids.length} pending settings audit rows: ${applied.length} applied, ${notApplied.length} not applied`
    );
  }
}
