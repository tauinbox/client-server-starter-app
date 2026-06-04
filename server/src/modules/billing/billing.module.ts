import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { parseRedisConnection } from '../../common/utils/parse-redis-connection';
import { BillingService } from './billing.service';
import { BillingConfigService } from './config/billing-config.service';
import { BillingConfiguredAttributesRegistrar } from './registrars/billing-configured-attributes.registrar';
import { Customer } from './entities/customer.entity';
import { Invoice } from './entities/invoice.entity';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { EntitlementService } from './entitlements/entitlement.service';
import { EntitlementGuard } from './entitlements/entitlement.guard';
import { EntitlementCacheListener } from './listeners/entitlement-cache.listener';
import { BillingUserDeletedListener } from './listeners/billing-user-deleted.listener';
import { PaddleProvider } from './providers/paddle.provider';
import { PADDLE_CLIENT, createPaddleClient } from './providers/paddle.client';
import { YooKassaProvider } from './providers/yookassa.provider';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from './providers/payment-provider.interface';
import { FixedRating } from './rating/fixed-rating.strategy';
import { UsageRating } from './rating/usage-rating.strategy';
import { BillingWebhooksController } from './webhooks/billing-webhooks.controller';
import { WebhookIngestionService } from './webhooks/webhook-ingestion.service';
import { BillingEventReducer } from './webhooks/billing-event-reducer.service';
import { BillingWebhookProcessor } from './webhooks/billing-webhook.processor';
import { BILLING_WEBHOOK_QUEUE } from './webhooks/billing-webhook-queue.constants';

@Module({})
export class BillingModule {
  /**
   * Registers the webhook reduction queue + processor when REDIS_URL is set
   * (production, or local dev running Redis); otherwise WebhookIngestionService
   * reduces inline. Same optional-queue stance as MailModule.
   */
  static forRoot(): DynamicModule {
    const redisUrl = process.env['REDIS_URL'];

    return {
      module: BillingModule,
      imports: [
        FeatureFlagsModule,
        TypeOrmModule.forFeature([
          Customer,
          Plan,
          Subscription,
          Invoice,
          WebhookEvent
        ]),
        ...(redisUrl
          ? [
              BullModule.registerQueue({
                name: BILLING_WEBHOOK_QUEUE,
                connection: parseRedisConnection(redisUrl)
              })
            ]
          : [])
      ],
      controllers: [BillingWebhooksController],
      providers: [
        BillingService,
        BillingConfigService,
        BillingConfiguredAttributesRegistrar,
        EntitlementService,
        EntitlementGuard,
        EntitlementCacheListener,
        BillingUserDeletedListener,
        PaddleProvider,
        YooKassaProvider,
        FixedRating,
        UsageRating,
        WebhookIngestionService,
        BillingEventReducer,
        ...(redisUrl ? [BillingWebhookProcessor] : []),
        {
          provide: PADDLE_CLIENT,
          useFactory: createPaddleClient,
          inject: [ConfigService]
        },
        {
          provide: BILLING_PROVIDERS,
          useFactory: (
            paddle: PaddleProvider,
            yookassa: YooKassaProvider
          ): PaymentProvider[] => [paddle, yookassa],
          inject: [PaddleProvider, YooKassaProvider]
        }
      ],
      exports: [
        BillingService,
        BillingConfigService,
        EntitlementService,
        EntitlementGuard,
        BILLING_PROVIDERS
      ]
    };
  }
}
