import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SETTINGS_POLL_INTERVAL_NAME } from '../src/modules/core/settings-change-log/settings-change-log.service';

/**
 * Stops the 5 s poll of the settings change log in `app`. For a suite that
 * holds the first transaction of the process to force a race: the poll opens a
 * transaction of its own and would be the one held. A settings write of the
 * suite still applies the log after its commit.
 */
export function stopSettingsPoll(app: INestApplication): void {
  app.get(SchedulerRegistry).deleteInterval(SETTINGS_POLL_INTERVAL_NAME);
}
