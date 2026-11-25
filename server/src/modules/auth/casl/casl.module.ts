import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SETTINGS_DATA_SOURCE } from '../../../data-sources';
import { User } from '../../users/entities/user.entity';
import { Resource } from '../entities/resource.entity';
import { Action } from '../entities/action.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { PermissionService } from '../services/permission.service';
import { CaslAbilityFactory } from './casl-ability.factory';
import { ResourceService } from '../services/resource.service';
import { ResourceSyncService } from '../services/resource-sync.service';
import { ResourceRegistryService } from '../services/resource-registry.service';
import { MfaPolicyService } from '../services/mfa-policy.service';
import { CryptoModule } from '../../../common/crypto/crypto.module';
import { SettingsChangeLogModule } from '../../core/settings-change-log/settings-change-log.module';
import { RegionModule } from '../../core/region/region.module';
import { RbacSettingsChangedListener } from '../listeners/rbac-settings-changed.listener';

/**
 * Shared CASL module — provides PermissionService, CaslAbilityFactory,
 * ResourceService, and ResourceSyncService.
 * Its own module so that PermissionsGuard (applied via @Authorize) resolves
 * its deps in every module that carries a controller, without a circular
 * dependency between AuthModule and UsersModule.
 * MfaPolicyService lives here for the same reason: MfaRequiredGuard travels
 * with the same decorator and must resolve in every module that carries it.
 */
@Module({
  imports: [
    CryptoModule,
    DiscoveryModule,
    RegionModule,
    SettingsChangeLogModule,
    TypeOrmModule.forFeature([User]),
    TypeOrmModule.forFeature(
      [Resource, Action, Permission, RolePermission],
      SETTINGS_DATA_SOURCE
    )
  ],
  providers: [
    PermissionService,
    MfaPolicyService,
    CaslAbilityFactory,
    ResourceService,
    ResourceSyncService,
    ResourceRegistryService,
    RbacSettingsChangedListener
  ],
  exports: [
    SettingsChangeLogModule,
    PermissionService,
    MfaPolicyService,
    CaslAbilityFactory,
    ResourceService,
    ResourceRegistryService
  ]
})
export class CaslModule {}
