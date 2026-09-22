import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './services/users.service';
import { BreachedPasswordModule } from '../auth/breached-password/breached-password.module';

/**
 * The user data layer. The controller lives in `UsersApiModule`, because it
 * depends on `AuthModule`, which depends on this module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), BreachedPasswordModule],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
