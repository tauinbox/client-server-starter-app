import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersController } from './controllers/users.controller';
import { UsersService } from './services/users.service';
import { CaslModule } from '../auth/casl/casl.module';
import { BreachedPasswordModule } from '../auth/breached-password/breached-password.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    CaslModule,
    BreachedPasswordModule
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
