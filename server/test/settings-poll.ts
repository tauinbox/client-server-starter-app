import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SETTINGS_POLL_INTERVAL_NAME } from '../src/modules/core/settings-change-log/settings-change-log.service';
import { SETTINGS_WRITE_SETTLE_CRON_NAME } from '../src/modules/audit/settings-write-settle.service';

/**
 * Stops the background jobs of the settings writes in `app`: the 5 s poll of
 * the settings change log and the settle of their audit rows each minute. For
 * a suite that holds the first transaction of the process to force a race:
 * each job opens a transaction of its own and would be the one held. A
 * settings write of the suite still applies the log after its commit.
 */
export function stopSettingsPoll(app: INestApplication): void {
  const scheduler = app.get(SchedulerRegistry);

  scheduler.deleteInterval(SETTINGS_POLL_INTERVAL_NAME);
  scheduler.deleteCronJob(SETTINGS_WRITE_SETTLE_CRON_NAME);
}
