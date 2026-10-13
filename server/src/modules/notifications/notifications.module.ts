import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { LocalNotificationsBus, NotificationsBus } from './notifications-bus';
import { RedisNotificationsBus } from './redis-notifications-bus';
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
    },
    {
      provide: NotificationsBus,
      inject: [ConfigService],
      useFactory: (config: ConfigService): NotificationsBus => {
        const redisUrl = config.get<string>('REDIS_URL');
        // The parallel Jest apps share one Redis, so a shared bus would mix
        // the pushes of different suites. A suite that tests the bus sets it.
        return redisUrl && process.env['NODE_ENV'] !== 'test'
          ? new RedisNotificationsBus(redisUrl)
          : new LocalNotificationsBus();
      }
    }
  ],
  exports: [NotificationsService]
})
export class NotificationsModule {}
