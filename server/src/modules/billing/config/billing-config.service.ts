import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BillingProviderId } from '@app/shared/types';

/**
 * Env-derived "is this provider configured" signal (booleans only — no secrets
 * leak). A provider counts as configured when both of its credential env vars
 * are present. The env vars themselves are formalised (Joi + `.env.example` +
 * compose defaults); this service reads them through `ConfigService`,
 * which passes unknown env vars through (`allowUnknown`).
 */
@Injectable()
export class BillingConfigService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(provider: BillingProviderId): boolean {
    if (provider === 'paddle') {
      return Boolean(
        this.config.get('PADDLE_API_KEY') &&
        this.config.get('PADDLE_WEBHOOK_SECRET')
      );
    }
    return Boolean(
      this.config.get('YOOKASSA_SHOP_ID') &&
      this.config.get('YOOKASSA_SECRET_KEY')
    );
  }
}
