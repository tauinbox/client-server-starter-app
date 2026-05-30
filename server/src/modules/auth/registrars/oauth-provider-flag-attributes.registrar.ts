import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAUTH_PROVIDER_FLAGS } from '@app/shared/constants';
import { AttributeRegistryService } from '../../feature-flags/services/attribute-registry.service';

/**
 * Exposes, as feature-flag custom attributes, whether each OAuth provider is
 * configured (its `*_CLIENT_ID` env var is set — the same signal `AuthModule`'s
 * `conditionalProvider` uses to register the passport strategy). The seeded
 * `oauth-*` flags carry an `attribute / custom / eq true` rule against these
 * keys, so a provider button is shown only when env-configured AND the flag is
 * enabled. The value is read once at startup (env is request-stable), honoring
 * the attribute-registry's request-stable contract.
 *
 * Wired in `CoreModule` rather than `AuthModule`: `FeatureFlagsModule` already
 * imports `AuthModule`, so `AuthModule` cannot import it back without a cycle.
 */
@Injectable()
export class OAuthProviderFlagAttributesRegistrar implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    private readonly attributeRegistry: AttributeRegistryService
  ) {}

  onModuleInit(): void {
    for (const { envVar, attributeKey } of OAUTH_PROVIDER_FLAGS) {
      const configured = Boolean(this.configService.get(envVar));
      this.attributeRegistry.registerAttribute(attributeKey, () => configured);
    }
  }
}
