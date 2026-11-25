import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { configValidationSchema } from './config-validation.schema';
import { CacheModule } from '@nestjs/cache-manager';
import { buildCacheOptions } from './redis-cache.store';
import { buildThrottlerOptions } from './throttler-options';
import { buildLoggerOptions } from './logger-options';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadEntities, postgresConfig } from '../../postgres.config';
import {
  SETTINGS_DATA_SOURCE,
  SETTINGS_ENTITIES,
  regionalEntities,
  splitPoolMax
} from '../../data-sources';
import type { PoolSizes } from '../../data-sources';
import { SETTINGS_SCHEMA, sourceLogin } from '../../database-roles';
import { UsersModule } from '../users/users.module';
import { UsersApiModule } from '../users/users-api.module';
import { AuthModule } from '../auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GlobalExceptionFilter } from './filters';
import { MailModule } from '../mail/mail.module';
import { HealthModule } from './health/health.module';
import { RegionModule } from './region/region.module';
import { AuditModule } from '../audit/audit.module';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { RequestLoggingMiddleware } from './middleware/request-logging.middleware';
import { NoStoreMiddleware } from './middleware/no-store.middleware';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MetricsModule } from './metrics/metrics.module';
import { HttpMetricsInterceptor } from './interceptors/http-metrics.interceptor';
import { RESPONSE_SERIALIZER } from './interceptors/response-serializer.provider';
import { NotificationsModule } from '../notifications/notifications.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { BillingModule } from '../billing/billing.module';
import { OAuthProviderFlagAttributesRegistrar } from '../auth/registrars/oauth-provider-flag-attributes.registrar';

function poolOptions(config: ConfigService, pool: keyof PoolSizes) {
  return {
    max: splitPoolMax(config.getOrThrow<number>('DB_POOL_MAX'))[pool],
    idleTimeoutMillis: config.getOrThrow<number>('DB_POOL_IDLE_TIMEOUT'),
    connectionTimeoutMillis: config.getOrThrow<number>(
      'DB_POOL_CONNECTION_TIMEOUT'
    )
  };
}

@Module({})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes('{*path}')
      .apply(RequestLoggingMiddleware)
      .forRoutes('{*path}')
      .apply(NoStoreMiddleware)
      .forRoutes('{*path}');
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
            libraryOptions: {
              allowUnknown: true,
              abortEarly: false
            }
          }
        }),
        LoggerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            buildLoggerOptions(config.get<string>('ENVIRONMENT'))
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
            ...sourceLogin('regional', (key) => config.get<string>(key)),
            entities: regionalEntities(loadEntities()),
            extra: poolOptions(config, 'regional')
          })
        }),
        TypeOrmModule.forRootAsync({
          name: SETTINGS_DATA_SOURCE,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            ...postgresConfig(),
            ...sourceLogin('settings', (key) => config.get<string>(key)),
            schema: SETTINGS_SCHEMA,
            entities: [...SETTINGS_ENTITIES],
            migrations: [],
            extra: poolOptions(config, 'settings')
          })
        }),
        MetricsModule,
        MailModule.forRoot(),
        AuditModule,
        AuthModule,
        UsersModule,
        UsersApiModule,
        HealthModule,
        RegionModule,
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
        },
        RESPONSE_SERIALIZER
      ]
    };
  }
}
