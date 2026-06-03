import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';
import { MAIL_QUEUE } from './mail-queue.constants';
import { parseRedisConnection } from '../../common/utils/parse-redis-connection';

@Module({})
export class MailModule {
  /**
   * Registers a BullMQ-backed mail queue when REDIS_URL is set (production, or
   * local dev running Redis): emails are enqueued and delivered by MailProcessor
   * with retries/backoff. Without Redis, MailService falls back to sending
   * directly in-process — the existing behaviour — so the queue is optional and
   * matches the project's "Redis is optional locally" stance.
   */
  static forRoot(): DynamicModule {
    const redisUrl = process.env['REDIS_URL'];

    if (!redisUrl) {
      return {
        module: MailModule,
        global: true,
        providers: [MailService],
        exports: [MailService]
      };
    }

    return {
      module: MailModule,
      global: true,
      imports: [
        BullModule.forRoot({ connection: parseRedisConnection(redisUrl) }),
        BullModule.registerQueue({ name: MAIL_QUEUE })
      ],
      providers: [MailService, MailProcessor],
      exports: [MailService]
    };
  }
}
