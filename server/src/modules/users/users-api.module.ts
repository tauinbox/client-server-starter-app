import { Module } from '@nestjs/common';
import { UsersController } from './controllers/users.controller';
import { UsersModule } from './users.module';
import { AuthModule } from '../auth/auth.module';

/**
 * The HTTP surface of the users module. It is a module of its own because the
 * credential edits of `PATCH /users/:id` demand the step-up of `AuthService`,
 * and `AuthModule` imports `UsersModule` for `UsersService`. Hosting the
 * controller here keeps both edges one-way.
 */
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [UsersController]
})
export class UsersApiModule {}
