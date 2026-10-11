import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BillingProviderId } from '@app/shared/types';

/**
 * Env-derived "is this provider configured" signal (booleans only — no secrets
 * leak). A provider counts as configured when both of its credential env vars
 * are present. The env vars themselves are formalised (Joi + `.env.example` +
 * compose defaults); this service reads them through `ConfigService`,
 * which passes unknown env vars through (`allowUnknown`).
 *
 * YooKassa also needs `REDIS_URL`: the server renews its subscriptions itself,
 * and the renewal scan runs only on the BullMQ queue. Without it a sold period
 * would never renew and never lapse.
 */
@Injectable()
export class BillingConfigService implements OnModuleInit {
  private readonly logger = new Logger(BillingConfigService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.hasYooKassaKeys() && !this.config.get('REDIS_URL')) {
      this.logger.warn(
        'YooKassa keys are set but REDIS_URL is not: YooKassa stays disabled, because nothing would renew its subscriptions'
      );
    }
  }

  isConfigured(provider: BillingProviderId): boolean {
    if (provider === 'paddle') {
      return Boolean(
        this.config.get('PADDLE_API_KEY') &&
        this.config.get('PADDLE_WEBHOOK_SECRET')
      );
    }
    return this.hasYooKassaKeys() && Boolean(this.config.get('REDIS_URL'));
  }

  private hasYooKassaKeys(): boolean {
    return Boolean(
      this.config.get('YOOKASSA_SHOP_ID') &&
      this.config.get('YOOKASSA_SECRET_KEY')
    );
  }
}
