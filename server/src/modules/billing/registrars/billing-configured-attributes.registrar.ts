import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  BILLING_CONFIGURED_ATTRIBUTE,
  BILLING_PROVIDER_FLAGS
} from '@app/shared/constants';
import { AttributeRegistryService } from '../../feature-flags/services/attribute-registry.service';
import { BillingConfigService } from '../config/billing-config.service';

/**
 * Exposes, as feature-flag custom attributes, whether each billing provider is
 * env-configured (`paddleConfigured` / `yookassaConfigured`) plus the combined
 * `billingConfigured = paddle || yookassa`. The public `billing` flag carries an
 * `attribute / custom / eq true` rule on `billingConfigured`, so billing UI is
 * shown only when at least one provider is configured AND the flag is enabled.
 * Mirror of `OAuthProviderFlagAttributesRegistrar`.
 *
 * Values are read once at startup (env is request-stable), honoring the
 * attribute-registry's request-stable contract.
 */
@Injectable()
export class BillingConfiguredAttributesRegistrar implements OnModuleInit {
  constructor(
    private readonly billingConfig: BillingConfigService,
    private readonly attributeRegistry: AttributeRegistryService
  ) {}

  onModuleInit(): void {
    let anyConfigured = false;
    for (const { provider, configuredAttribute } of BILLING_PROVIDER_FLAGS) {
      const configured = this.billingConfig.isConfigured(provider);
      anyConfigured ||= configured;
      this.attributeRegistry.registerAttribute(
        configuredAttribute,
        () => configured
      );
    }
    this.attributeRegistry.registerAttribute(
      BILLING_CONFIGURED_ATTRIBUTE,
      () => anyConfigured
    );
  }
}
