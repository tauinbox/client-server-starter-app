import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import { parseRedisConnection } from '../../common/utils/parse-redis-connection';
import { BillingService } from './billing.service';
import { BillingConfigService } from './config/billing-config.service';
import { BillingConfiguredAttributesRegistrar } from './registrars/billing-configured-attributes.registrar';
import { CreditBalance } from './entities/credit-balance.entity';
import { CreditLedger } from './entities/credit-ledger.entity';
import { Customer } from './entities/customer.entity';
import { CustomerGrant } from './entities/customer-grant.entity';
import { Invoice } from './entities/invoice.entity';
import { Product } from './entities/product.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { UsageRecord } from './entities/usage-record.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { EntitlementChangedListener } from './listeners/entitlement-changed.listener';
import { BillingUserDeletedListener } from './listeners/billing-user-deleted.listener';
import { PaddleProvider } from './providers/paddle.provider';
import { PADDLE_CLIENT, createPaddleClient } from './providers/paddle.client';
import { YooKassaProvider } from './providers/yookassa.provider';
import {
  YOOKASSA_CLIENT,
  createYooKassaClient
} from './providers/yookassa.client';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from './providers/payment-provider.interface';
import {
  DEFAULT_BILLING_PROVIDER_TIMEOUT_MS,
  withProviderDeadline
} from './providers/provider-deadline';
import { FixedRating } from './rating/fixed-rating.strategy';
import { UsageRating } from './rating/usage-rating.strategy';
import { ProrationCalculator } from './rating/proration-calculator';
import { PlanService } from './services/plan.service';
import { CreditService } from './services/credit.service';
import { BillingUserService } from './services/billing-user.service';
import { BillingAdminService } from './services/billing-admin.service';
import { UsageService } from './services/usage.service';
import { UsageInvoicingService } from './services/usage-invoicing.service';
import { BillingPlansController } from './controllers/billing-plans.controller';
import { BillingUserController } from './controllers/billing-user.controller';
import { BillingAdminController } from './controllers/billing-admin.controller';
import { BillingWebhooksController } from './webhooks/billing-webhooks.controller';
import { WebhookIngestionService } from './webhooks/webhook-ingestion.service';
import { WebhookIpAllowlistGuard } from './webhooks/webhook-ip-allowlist.guard';
import { WebhookReconciliationService } from './webhooks/webhook-reconciliation.service';
import { WebhookRetentionService } from './webhooks/webhook-retention.service';
import { BillingEventReducer } from './webhooks/billing-event-reducer.service';
import { BillingWebhookProcessor } from './webhooks/billing-webhook.processor';
import { BILLING_WEBHOOK_QUEUE } from './webhooks/billing-webhook-queue.constants';
import { RenewalService } from './renewals/renewal.service';
import { RenewalProcessor } from './renewals/renewal.processor';
import { BILLING_RENEWAL_QUEUE } from './renewals/renewal-queue.constants';

@Module({})
export class BillingModule {
  /**
   * Registers the webhook reduction queue + processor when REDIS_URL is set
   * (production, or local dev running Redis); otherwise WebhookIngestionService
   * reduces inline. Same optional-queue stance as MailModule.
   */
  static forRoot(): DynamicModule {
    const redisUrl = process.env['REDIS_URL'];
    // The renewal scheduler self-registers a repeatable scan on bootstrap, so —
    // unlike the on-demand webhook processor — it would fire in every booted app.
    // Skip it under Jest: the short-lived test apps would otherwise pollute Redis
    // with schedulers and race the scan against DataSource teardown. RenewalService
    // is still provided and exercised directly in tests.
    const renewalEnabled =
      Boolean(redisUrl) && process.env['NODE_ENV'] !== 'test';

    return {
      module: BillingModule,
      imports: [
        AuthModule,
        EntitlementsModule,
        FeatureFlagsModule,
        NotificationsModule,
        TypeOrmModule.forFeature([
          CreditBalance,
          CreditLedger,
          Customer,
          CustomerGrant,
          Plan,
          Product,
          Subscription,
          Invoice,
          PaymentMethod,
          UsageRecord,
          WebhookEvent,
          // Read-only: the YooKassa provider resolves the buyer email from the
          // user record to fiscalize 54-FZ receipts.
          User
        ]),
        ...(redisUrl
          ? [
              BullModule.registerQueue({
                name: BILLING_WEBHOOK_QUEUE,
                connection: parseRedisConnection(redisUrl)
              })
            ]
          : []),
        ...(renewalEnabled
          ? [
              BullModule.registerQueue({
                name: BILLING_RENEWAL_QUEUE,
                connection: parseRedisConnection(redisUrl as string)
              })
            ]
          : [])
      ],
      controllers: [
        BillingPlansController,
        BillingUserController,
        BillingAdminController,
        BillingWebhooksController
      ],
      providers: [
        BillingService,
        BillingConfigService,
        PlanService,
        CreditService,
        BillingUserService,
        BillingAdminService,
        UsageService,
        UsageInvoicingService,
        BillingConfiguredAttributesRegistrar,
        EntitlementChangedListener,
        BillingUserDeletedListener,
        PaddleProvider,
        YooKassaProvider,
        FixedRating,
        UsageRating,
        ProrationCalculator,
        WebhookIngestionService,
        WebhookIpAllowlistGuard,
        BillingEventReducer,
        RenewalService,
        ...(redisUrl
          ? [
              WebhookReconciliationService,
              WebhookRetentionService,
              BillingWebhookProcessor
            ]
          : []),
        ...(renewalEnabled ? [RenewalProcessor] : []),
        {
          provide: PADDLE_CLIENT,
          useFactory: createPaddleClient,
          inject: [ConfigService]
        },
        {
          provide: YOOKASSA_CLIENT,
          useFactory: createYooKassaClient,
          inject: [ConfigService]
        },
        {
          provide: BILLING_PROVIDERS,
          useFactory: (
            paddle: PaddleProvider,
            yookassa: YooKassaProvider,
            config: ConfigService
          ): PaymentProvider[] => {
            const timeoutMs = Number(
              config.get<string>('BILLING_PROVIDER_TIMEOUT_MS') ??
                DEFAULT_BILLING_PROVIDER_TIMEOUT_MS
            );
            return [paddle, yookassa].map((provider) =>
              withProviderDeadline(provider, timeoutMs)
            );
          },
          inject: [PaddleProvider, YooKassaProvider, ConfigService]
        }
      ],
      exports: [
        BillingService,
        BillingConfigService,
        // Re-exported as a module: `EntitlementService`/`EntitlementGuard` are
        // provided by `EntitlementsModule`, so importers of `BillingModule`
        // keep resolving both without changing an import path.
        EntitlementsModule,
        UsageService,
        CreditService,
        BILLING_PROVIDERS
      ]
    };
  }
}
