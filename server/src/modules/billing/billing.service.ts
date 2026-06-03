import {
  Inject,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import type { BillingProviderId } from '@app/shared/types';
import { FeatureFlagService } from '../feature-flags/services/feature-flag.service';
import type { Customer } from './entities/customer.entity';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from './providers/payment-provider.interface';
import { BillingConfigService } from './config/billing-config.service';

/** Admin kill-switch flag per provider (seeded in M0.6, default off). */
const PROVIDER_ENABLED_FLAG: Record<BillingProviderId, string> = {
  paddle: 'billing.provider.paddle.enabled',
  yookassa: 'billing.provider.yookassa.enabled'
};

/** Geo default: Russia → YooKassa (54-FZ), everywhere else → Paddle (MoR). */
function geoDefault(country: string): BillingProviderId {
  return country.toUpperCase() === 'RU' ? 'yookassa' : 'paddle';
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_PROVIDERS)
    private readonly providers: PaymentProvider[],
    private readonly featureFlags: FeatureFlagService,
    private readonly billingConfig: BillingConfigService
  ) {}

  /**
   * Selects the effective provider for a customer: a manual override wins over
   * the geo default (§19). The effective provider must be both enabled (admin
   * kill-switch flag) and configured (env credentials present), else billing is
   * unavailable for that geo — a `503`, the server-side enforcement behind the
   * UI availability gating (§18.4).
   */
  async resolveProvider(
    customer: Pick<Customer, 'providerOverride' | 'country'>
  ): Promise<PaymentProvider> {
    const effective = customer.providerOverride ?? geoDefault(customer.country);

    const enabled = await this.isProviderEnabled(effective);
    const configured = this.billingConfig.isConfigured(effective);
    if (!enabled || !configured) {
      throw new ServiceUnavailableException(
        `Billing provider "${effective}" is not available`
      );
    }

    const provider = this.providers.find((p) => p.id === effective);
    if (!provider) {
      throw new ServiceUnavailableException(
        `Billing provider "${effective}" is not registered`
      );
    }
    return provider;
  }

  private async isProviderEnabled(
    provider: BillingProviderId
  ): Promise<boolean> {
    const flagKey = PROVIDER_ENABLED_FLAG[provider];
    const flags = await this.featureFlags.findAll();
    return flags.find((f) => f.key === flagKey)?.enabled ?? false;
  }
}
