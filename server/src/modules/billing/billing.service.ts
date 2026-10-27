import { Inject, Injectable } from '@nestjs/common';
import type { BillingProviderId } from '@app/shared/types';
import { BILLING_PROVIDER_FLAGS, ErrorKeys } from '@app/shared/constants';
import { geoDefault } from '@app/shared/utils/billing-rules';
import { FeatureFlagResolverService } from '../feature-flags/services/feature-flag-resolver.service';
import type { Customer } from './entities/customer.entity';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from './providers/payment-provider.interface';
import { BillingConfigService } from './config/billing-config.service';
import { ApiError } from '../../common/errors/api-error';

/** Admin kill-switch flag per provider (seeded disabled by default). */
const PROVIDER_ENABLED_FLAG: Record<BillingProviderId, string> =
  Object.fromEntries(
    BILLING_PROVIDER_FLAGS.map((p) => [p.provider, p.enabledFlagKey])
  ) as Record<BillingProviderId, string>;

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_PROVIDERS)
    private readonly providers: PaymentProvider[],
    private readonly featureFlags: FeatureFlagResolverService,
    private readonly billingConfig: BillingConfigService
  ) {}

  /**
   * Selects the effective provider for a customer: a manual override wins over
   * the geo default. The effective provider must be both enabled (the admin
   * kill-switch flag, fully evaluated for the customer's user) and configured
   * (env credentials present), else billing is unavailable for that geo. This
   * is the server-side enforcement behind the UI availability gating.
   */
  async resolveProvider(
    customer: Pick<Customer, 'providerOverride' | 'country' | 'userId'>
  ): Promise<PaymentProvider> {
    const effective = customer.providerOverride ?? geoDefault(customer.country);

    if (!this.billingConfig.isConfigured(effective)) {
      throw new ApiError(
        ErrorKeys.BILLING.PROVIDER_NOT_CONFIGURED,
        `Billing provider "${effective}" is not configured`
      );
    }
    if (!(await this.isProviderEnabled(effective, customer.userId))) {
      throw new ApiError(
        ErrorKeys.BILLING.PROVIDER_UNAVAILABLE,
        `Billing provider "${effective}" is not available`
      );
    }

    return this.getProviderById(effective);
  }

  /**
   * Whether `resolveProvider` would accept this provider for this user:
   * enabled, configured and registered.
   */
  async isProviderAvailable(
    id: BillingProviderId,
    userId: string
  ): Promise<boolean> {
    return (
      this.billingConfig.isConfigured(id) &&
      this.providers.some((p) => p.id === id) &&
      (await this.isProviderEnabled(id, userId))
    );
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

  /**
   * The registered provider instance for `id`, with no enabled/configured
   * check: an existing subscription or invoice keeps its provider. Throws for
   * an unregistered id, so no caller can skip the provider call and still
   * record the result locally.
   */
  getProviderById(id: BillingProviderId): PaymentProvider {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) {
      throw new ApiError(
        ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR,
        `Billing provider "${id}" is not registered`
      );
    }
    return provider;
  }

  private isProviderEnabled(
    provider: BillingProviderId,
    userId: string
  ): Promise<boolean> {
    return this.featureFlags.isEnabledForUserId(
      userId,
      PROVIDER_ENABLED_FLAG[provider]
    );
  }
}
