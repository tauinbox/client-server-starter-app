import type { SubscriptionStatus } from '../types/billing.types';

/**
 * The three subscription-status sets the whole system reasons in, shared so the
 * server and the mock cannot drift apart. Every set is typed against
 * `SubscriptionStatus`, so a status that leaves the union fails the build here
 * instead of silently dropping rows at a call site.
 *
 * These are *definitions*, not call-site policy. Two sets being equal today is
 * not a reason to merge them, and a call site whose meaning genuinely differs
 * keeps its own list with a comment saying why.
 */

/**
 * Grants entitlements, is chargeable, and accrues metered usage. `past_due`
 * stays in through the dunning grace window: the drop happens on the
 * `past_due -> canceled` transition, not on entering `past_due`.
 */
export const ENTITLED_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due'
];

/**
 * Non-canceled — the "current" subscription for read, cancel and region
 * resolution, and every status a first payment can land on.
 */
export const OPEN_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'incomplete',
  'trialing',
  'active',
  'past_due'
];

/**
 * A plan change may start from these. `past_due` must settle its debt first (a
 * switch would tangle proration with dunning); `incomplete` has nothing to
 * prorate yet.
 */
export const CHANGEABLE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active'
];

export function isOpenStatus(status: SubscriptionStatus): boolean {
  return OPEN_SUBSCRIPTION_STATUSES.includes(status);
}
