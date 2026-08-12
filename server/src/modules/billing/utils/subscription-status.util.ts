import type { SubscriptionStatus } from '@app/shared/types';

/** Non-canceled statuses — the "current" subscription for read/cancel/region. */
export const OPEN_STATUSES: readonly SubscriptionStatus[] = [
  'incomplete',
  'trialing',
  'active',
  'past_due'
];

export function isOpenStatus(status: SubscriptionStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
