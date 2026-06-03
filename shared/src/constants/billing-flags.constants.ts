import type { BillingProviderId } from '../types/billing.types';

/**
 * Single source of truth for the billing feature-flag / availability wiring,
 * mirroring the OAuth-provider-flags pattern. Consumed by the server attribute
 * registrar + seeder, the geo-router (`BillingService`), and the mock-server
 * flag evaluator + seed. The DB migration mirrors these literals but does not
 * import them (migrations are historical records).
 *
 * Two distinct flag axes:
 *  - the public `billing` flag (UI availability), gated by `billingConfigured`;
 *  - the per-provider `enabledFlagKey` admin kill-switches the geo-router reads.
 */

/** Public flag gating whether billing appears in the UI at all. */
export const BILLING_FLAG_KEY = 'billing';

/**
 * Combined env-configured signal: `paddleConfigured || yookassaConfigured`. The
 * public `billing` flag carries an `attribute / custom / eq true` rule on this
 * key, so billing UI shows only when at least one provider is configured.
 */
export const BILLING_CONFIGURED_ATTRIBUTE = 'billingConfigured';

export const BILLING_PROVIDER_FLAGS = [
  {
    provider: 'paddle',
    configuredAttribute: 'paddleConfigured',
    enabledFlagKey: 'billing.provider.paddle.enabled'
  },
  {
    provider: 'yookassa',
    configuredAttribute: 'yookassaConfigured',
    enabledFlagKey: 'billing.provider.yookassa.enabled'
  }
] as const satisfies ReadonlyArray<{
  provider: BillingProviderId;
  configuredAttribute: string;
  enabledFlagKey: string;
}>;

export type BillingProviderFlag = (typeof BILLING_PROVIDER_FLAGS)[number];
