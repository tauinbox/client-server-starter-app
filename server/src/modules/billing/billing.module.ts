import { Module } from '@nestjs/common';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { BillingService } from './billing.service';
import { BillingConfigService } from './config/billing-config.service';
import { PaddleProvider } from './providers/paddle.provider';
import { YooKassaProvider } from './providers/yookassa.provider';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from './providers/payment-provider.interface';
import { FixedRating } from './rating/fixed-rating.strategy';
import { UsageRating } from './rating/usage-rating.strategy';

@Module({
  imports: [FeatureFlagsModule],
  providers: [
    BillingService,
    BillingConfigService,
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
  exports: [BillingService, BillingConfigService, BILLING_PROVIDERS]
})
export class BillingModule {}
