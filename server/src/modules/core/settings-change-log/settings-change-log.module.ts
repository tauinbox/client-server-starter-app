import { Module } from '@nestjs/common';
import { SettingsChangeLogService } from './settings-change-log.service';
import { RegionModule } from '../region/region.module';

/**
 * The apply of the settings change log. Each module that writes settings
 * imports it and calls `applyPending` after the commit; Nest keeps one
 * instance of the module, so one poll runs in each process.
 */
@Module({
  imports: [RegionModule],
  providers: [SettingsChangeLogService],
  exports: [SettingsChangeLogService]
})
export class SettingsChangeLogModule {}
