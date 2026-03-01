import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity';
import { PermissionService } from '../services/permission.service';
import { CaslAbilityFactory } from './casl-ability.factory';

/**
 * Shared CASL module — provides PermissionService and CaslAbilityFactory.
 * Imported by both AuthModule and UsersModule so that PermissionsGuard
 * (applied via @Authorize in UsersController) can resolve its deps without
 * creating a circular dependency between AuthModule and UsersModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [PermissionService, CaslAbilityFactory],
  exports: [PermissionService, CaslAbilityFactory]
})
export class CaslModule {}
