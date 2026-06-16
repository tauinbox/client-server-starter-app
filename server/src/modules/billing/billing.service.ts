import {
  Inject,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import type { BillingProviderId } from '@app/shared/types';
import { BILLING_PROVIDER_FLAGS } from '@app/shared/constants';
import { FeatureFlagService } from '../feature-flags/services/feature-flag.service';
import type { Customer } from './entities/customer.entity';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from './providers/payment-provider.interface';
import { BillingConfigService } from './config/billing-config.service';

/** Admin kill-switch flag per provider (seeded disabled by default). */
const PROVIDER_ENABLED_FLAG: Record<BillingProviderId, string> =
  Object.fromEntries(
    BILLING_PROVIDER_FLAGS.map((p) => [p.provider, p.enabledFlagKey])
  ) as Record<BillingProviderId, string>;

/** Geo default: country code 'RU' → YooKassa, everywhere else → Paddle. */
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
   * the geo default. The effective provider must be both enabled (admin
   * kill-switch flag) and configured (env credentials present), else billing is
   * unavailable for that geo — a `503`, the server-side enforcement behind the
   * UI availability gating.
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

  /** Geo default provider for a country (no enabled/configured check). */
  geoDefaultFor(country: string): BillingProviderId {
    return geoDefault(country);
  }

  /**
   * The provider the next checkout would use — a manual override wins over the
   * geo default. Informational (the `GET /billing/region` view); unlike
   * `resolveProvider` it does not assert availability.
   */
  effectiveProviderId(
    customer: Pick<Customer, 'providerOverride' | 'country'>
  ): BillingProviderId {
    return customer.providerOverride ?? geoDefault(customer.country);
  }

  /** Looks up a registered provider instance by id (cancel/refund dispatch). */
  getProviderById(id: BillingProviderId): PaymentProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  private async isProviderEnabled(
    provider: BillingProviderId
  ): Promise<boolean> {
    const flagKey = PROVIDER_ENABLED_FLAG[provider];
    const flag = await this.featureFlags.findByKey(flagKey);
    return flag?.enabled ?? false;
  }
}
