import type { EntitlementLimits } from '@app/shared/types';

/**
 * Billing capabilities — a separate axis from feature flags:
 * flags are admin-toggled rollout tools, entitlements are what a paid plan grants.
 * Free = empty set (base access only). The numeric limit dimension travels
 * alongside the capability set in `ResolvedEntitlements.limits`, keyed by the
 * shared `EntitlementLimitKey` union.
 */
export type EntitlementCapability =
  | 'reports'
  | 'api-access'
  | 'data-export'
  | 'priority-support';

/** Plan key of the default (no-subscription) tier. */
export const FREE_PLAN_KEY = 'free';

/**
 * The capability set + numeric limits in effect for a user, resolved from their
 * active/trialing/past_due-in-grace subscription's plan, or the Free tier.
 * `capabilities` stays `string[]` (it mirrors `Plan.entitlements`, which is
 * data-driven and may carry keys beyond the typed catalog above).
 */
export interface ResolvedEntitlements {
  planKey: string;
  capabilities: string[];
  limits: EntitlementLimits;
}
