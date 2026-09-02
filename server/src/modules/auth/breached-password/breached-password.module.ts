import { Module } from '@nestjs/common';
import { BreachedPasswordService } from './breached-password.service';

/**
 * Its own module because both AuthModule and UsersModule set passwords, and it
 * depends on neither. Folding it into AuthModule would force UsersModule to
 * import AuthModule, which imports UsersModule.
 */
@Module({
  providers: [BreachedPasswordService],
  exports: [BreachedPasswordService]
})
export class BreachedPasswordModule {}
