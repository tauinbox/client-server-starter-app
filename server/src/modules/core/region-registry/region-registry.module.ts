import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SETTINGS_DATA_SOURCE } from '../../../data-sources';
import { AuthModule } from '../../auth/auth.module';
import { RegionModule } from '../region/region.module';
import { SettingsChangeLogModule } from '../settings-change-log/settings-change-log.module';
import { RegionRegistryEntry } from './entities/region-registry-entry.entity';
import { RegionRegistryService } from './region-registry.service';
import { RegionConfigController } from './controllers/region-config.controller';
import { RegionsAdminController } from './controllers/regions-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RegionRegistryEntry], SETTINGS_DATA_SOURCE),
    AuthModule,
    RegionModule,
    SettingsChangeLogModule
  ],
  controllers: [RegionConfigController, RegionsAdminController],
  providers: [RegionRegistryService],
  exports: [RegionRegistryService]
})
export class RegionRegistryModule {}
