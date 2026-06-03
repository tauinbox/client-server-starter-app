import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { BillingService } from './billing.service';
import { BillingConfigService } from './config/billing-config.service';
import { Customer } from './entities/customer.entity';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { EntitlementService } from './entitlements/entitlement.service';
import { EntitlementGuard } from './entitlements/entitlement.guard';
import { EntitlementCacheListener } from './listeners/entitlement-cache.listener';
import { BillingUserDeletedListener } from './listeners/billing-user-deleted.listener';
import { PaddleProvider } from './providers/paddle.provider';
import { YooKassaProvider } from './providers/yookassa.provider';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from './providers/payment-provider.interface';
import { FixedRating } from './rating/fixed-rating.strategy';
import { UsageRating } from './rating/usage-rating.strategy';

@Module({
  imports: [
    FeatureFlagsModule,
    TypeOrmModule.forFeature([Customer, Plan, Subscription])
  ],
  providers: [
    BillingService,
    BillingConfigService,
    EntitlementService,
    EntitlementGuard,
    EntitlementCacheListener,
    BillingUserDeletedListener,
    PaddleProvider,
    YooKassaProvider,
    FixedRating,
    UsageRating,
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
})
export class BillingModule {}
