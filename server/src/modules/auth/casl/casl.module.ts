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

/**
 * Shared CASL module — provides PermissionService, CaslAbilityFactory,
 * ResourceService, ActionService, and ResourceSyncService.
 * Imported by both AuthModule and UsersModule so that PermissionsGuard
 * (applied via @Authorize in UsersController) can resolve its deps without
 * creating a circular dependency between AuthModule and UsersModule.
 */
@Module({
  imports: [
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
    CaslAbilityFactory,
    ResourceService,
    ActionService,
    ResourceSyncService
  ],
  exports: [
    PermissionService,
    CaslAbilityFactory,
    ResourceService,
    ActionService
  ]
})
export class CaslModule {}
