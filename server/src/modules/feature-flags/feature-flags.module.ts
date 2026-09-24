import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FeatureFlagRule } from './entities/feature-flag-rule.entity';
import { FeatureFlagService } from './services/feature-flag.service';
import { FeatureFlagResolverService } from './services/feature-flag-resolver.service';
import { AttributeRegistryService } from './services/attribute-registry.service';
import { FeatureFlagsAdminController } from './controllers/feature-flags-admin.controller';
import { FeatureFlagsController } from './controllers/feature-flags.controller';
import { FeatureFlagChangedListener } from './listeners/feature-flag-changed.listener';
import { FeatureFlagGuard } from './guards/feature-flag.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeatureFlag, FeatureFlagRule]),
    AuthModule,
    UsersModule,
    NotificationsModule
  ],
  controllers: [FeatureFlagsAdminController, FeatureFlagsController],
  providers: [
    FeatureFlagService,
    FeatureFlagResolverService,
    AttributeRegistryService,
    FeatureFlagChangedListener,
    FeatureFlagGuard
  ],
  exports: [
    FeatureFlagService,
    FeatureFlagResolverService,
    AttributeRegistryService
  ]
})
export class FeatureFlagsModule {}
