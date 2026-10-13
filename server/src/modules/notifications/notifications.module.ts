import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { CaslModule } from '../auth/casl/casl.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import {
  DEFAULT_SSE_HEARTBEAT_INTERVAL_MS,
  SSE_HEARTBEAT_INTERVAL_MS
} from './notifications.constants';

@Module({
  imports: [CaslModule, AuthModule, UsersModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsListener,
    {
      provide: SSE_HEARTBEAT_INTERVAL_MS,
      useValue: DEFAULT_SSE_HEARTBEAT_INTERVAL_MS
    }
  ],
  exports: [NotificationsService]
})
export class NotificationsModule {}
