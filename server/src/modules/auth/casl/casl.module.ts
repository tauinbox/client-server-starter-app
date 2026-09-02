import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity';
import { Resource } from '../entities/resource.entity';
import { Action } from '../entities/action.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { PermissionService } from '../services/permission.service';
import { CaslAbilityFactory } from './casl-ability.factory';
import { ResourceService } from '../services/resource.service';
import { ActionService } from '../services/action.service';
import { ResourceSyncService } from '../services/resource-sync.service';
import { ResourceRegistryService } from '../services/resource-registry.service';
import { MfaPolicyService } from '../services/mfa-policy.service';
import { CryptoModule } from '../../../common/crypto/crypto.module';

/**
 * Shared CASL module — provides PermissionService, CaslAbilityFactory,
 * ResourceService, ActionService, and ResourceSyncService.
 * Imported by both AuthModule and UsersModule so that PermissionsGuard
 * (applied via @Authorize in UsersController) can resolve its deps without
 * creating a circular dependency between AuthModule and UsersModule.
 * MfaPolicyService lives here for the same reason: MfaRequiredGuard travels
 * with the same decorator and must resolve in every module that carries it.
 */
@Module({
  imports: [
    CryptoModule,
    DiscoveryModule,
    TypeOrmModule.forFeature([
      User,
      Resource,
      Action,
      Permission,
      RolePermission
    ])
  ],
  providers: [
    PermissionService,
    MfaPolicyService,
    CaslAbilityFactory,
    ResourceService,
    ActionService,
    ResourceSyncService,
    ResourceRegistryService
  ],
  exports: [
    PermissionService,
    MfaPolicyService,
    CaslAbilityFactory,
    ResourceService,
    ActionService,
    ResourceRegistryService
  ]
})
export class CaslModule {}
