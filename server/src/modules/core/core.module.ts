import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { configValidationSchema } from './config-validation.schema';
import { CacheModule } from '@nestjs/cache-manager';
import { buildCacheOptions } from './redis-cache.store';
import { buildThrottlerOptions } from './throttler-options';
import { TypeOrmModule } from '@nestjs/typeorm';
import { postgresConfig } from '../../postgres.config';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GlobalExceptionFilter } from './filters';
import { MailModule } from '../mail/mail.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from '../audit/audit.module';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { RequestLoggingMiddleware } from './middleware/request-logging.middleware';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MetricsModule } from './metrics/metrics.module';
import { HttpMetricsInterceptor } from './interceptors/http-metrics.interceptor';
import { NotificationsModule } from '../notifications/notifications.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { BillingModule } from '../billing/billing.module';
import { OAuthProviderFlagAttributesRegistrar } from '../auth/registrars/oauth-provider-flag-attributes.registrar';

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
          isGlobal: true,
          validationSchema: configValidationSchema,
          validationOptions: {
            allowUnknown: true,
            abortEarly: false
          }
        }),
        LoggerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            pinoHttp: {
              // HTTP request logging is handled by RequestLoggingMiddleware
              autoLogging: false,
              level:
                config.get('ENVIRONMENT') === 'production' ? 'info' : 'debug',
              transport:
                config.get('ENVIRONMENT') !== 'production'
                  ? {
                      target: 'pino-pretty',
                      options: { colorize: true, singleLine: true }
                    }
                  : undefined
            }
          })
        }),
        EventEmitterModule.forRoot(),
        CacheModule.registerAsync({
          isGlobal: true,
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            buildCacheOptions(config.get<string>('REDIS_URL'))
        }),
        ScheduleModule.forRoot(),
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            buildThrottlerOptions(config.get<string>('REDIS_URL'))
        }),
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            ...postgresConfig(),
            extra: {
              max: config.getOrThrow<number>('DB_POOL_MAX'),
              idleTimeoutMillis: config.getOrThrow<number>(
                'DB_POOL_IDLE_TIMEOUT'
              ),
              connectionTimeoutMillis: config.getOrThrow<number>(
                'DB_POOL_CONNECTION_TIMEOUT'
              )
            }
          })
        }),
        MetricsModule,
        MailModule.forRoot(),
        AuditModule,
        AuthModule,
        UsersModule,
        HealthModule,
        NotificationsModule,
        FeatureFlagsModule,
        BillingModule.forRoot()
      ],
      providers: [
        OAuthProviderFlagAttributesRegistrar,
        {
          provide: APP_FILTER,
          useClass: GlobalExceptionFilter
        },
        {
          provide: APP_GUARD,
          useClass: JwtAuthGuard
        },
        {
          provide: APP_GUARD,
          useClass: LoginThrottlerGuard
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: HttpMetricsInterceptor
        }
      ]
    };
  }
}
