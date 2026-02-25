import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import configuration from './configuration';
import { CacheModule } from '@nestjs/cache-manager';
import { FeatureModule } from '../feature/feature.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { postgresConfig } from '../../postgres.config';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './filters';
import { MailModule } from '../mail/mail.module';
import { HealthModule } from './health/health.module';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { RequestLoggingMiddleware } from './middleware/request-logging.middleware';

@Module({})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes('*')
      .apply(RequestLoggingMiddleware)
      .forRoutes('*');
  }

  static forRoot(): DynamicModule {
    return {
      module: CoreModule,
      global: true,
      imports: [
        ConfigModule.forRoot({
          load: [configuration],
          isGlobal: true
        }),
        CacheModule.register({
          isGlobal: true
        }),
        ScheduleModule.forRoot(),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
        TypeOrmModule.forRootAsync({ imports: [], useFactory: postgresConfig }),
        MailModule,
        AuthModule,
        UsersModule,
        FeatureModule,
        HealthModule
      ],
      providers: [
        {
          provide: APP_FILTER,
          useClass: GlobalExceptionFilter
        },
        {
          provide: APP_GUARD,
          useClass: ThrottlerGuard
        }
      ]
    };
  }
}
