import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Joi from 'joi';
import { LoggerModule } from 'nestjs-pino';
import configuration from './configuration';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { TypeOrmModule } from '@nestjs/typeorm';
import { postgresConfig } from '../../postgres.config';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoginThrottlerGuard } from './login-throttler.guard';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS
} from '@app/shared/constants/auth.constants';
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
          isGlobal: true,
          validationSchema: Joi.object({
            APPLICATION_PORT: Joi.number().default(3000),
            ENVIRONMENT: Joi.string()
              .valid('local', 'development', 'staging', 'production')
              .default('production'),
            DB_HOST: Joi.string().required(),
            DB_PORT: Joi.number().default(5432),
            DB_NAME: Joi.string().required(),
            DB_USER: Joi.string().required(),
            DB_PASSWORD: Joi.string().required(),
            JWT_ALGORITHM: Joi.string()
              .valid('HS256', 'RS256')
              .default('HS256'),
            JWT_SECRET: Joi.string().min(16).when('JWT_ALGORITHM', {
              is: 'RS256',
              then: Joi.optional(),
              otherwise: Joi.required()
            }),
            JWT_PRIVATE_KEY: Joi.string().when('JWT_ALGORITHM', {
              is: 'RS256',
              then: Joi.required(),
              otherwise: Joi.optional()
            }),
            JWT_PUBLIC_KEY: Joi.string().when('JWT_ALGORITHM', {
              is: 'RS256',
              then: Joi.required(),
              otherwise: Joi.optional()
            }),
            JWT_MIN_IAT: Joi.number().integer().min(0).optional(),
            JWT_EXPIRATION: Joi.number().required(),
            JWT_REFRESH_EXPIRATION: Joi.number().required(),
            AUDIT_LOG_RETENTION_DAYS: Joi.number().min(1).default(90),
            DB_POOL_MAX: Joi.number().min(1).default(10),
            DB_POOL_IDLE_TIMEOUT: Joi.number().min(0).default(30000),
            DB_POOL_CONNECTION_TIMEOUT: Joi.number().min(0).default(5000)
          }),
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
          useFactory: async (config: ConfigService) => {
            const redisUrl = config.get<string>('REDIS_URL');
            if (!redisUrl) {
              return {};
            }
            const store = await redisStore({ url: redisUrl });
            return { store };
          }
        }),
        ScheduleModule.forRoot(),
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const redisUrl = config.get<string>('REDIS_URL');
            const throttlers = [
              { ttl: 60000, limit: 10 },
              {
                // Applied globally but overridden on the login route to prevent a
                // single IP from accumulating enough failed attempts to trigger
                // account lockout (SEC-6). High global limit = effectively disabled
                // on all other routes.
                name: 'login-long-window',
                ttl: LOCKOUT_DURATION_MS,
                limit: MAX_FAILED_ATTEMPTS * 1000
              }
            ];
            if (!redisUrl) {
              return { throttlers };
            }
            return { throttlers, storage: new RedisThrottlerStorage(redisUrl) };
          }
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
        MailModule,
        AuditModule,
        AuthModule,
        UsersModule,
        HealthModule,
        NotificationsModule
      ],
      providers: [
        {
          provide: APP_FILTER,
          useClass: GlobalExceptionFilter
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
