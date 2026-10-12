import type { CancelMode } from '@app/shared/types';
import type { Subscription } from '../entities/subscription.entity';

/**
 * The columns a cancellation owns. Every cancel path asks the provider first,
 * so its subscription entity is always older than the row it is about to write;
 * writing this set instead of the whole entity leaves the plan, the period and
 * the dunning state exactly as the concurrent writer left them.
 */
export function cancelFields(mode: CancelMode): Partial<Subscription> {
  return mode === 'immediate'
    ? { status: 'canceled', cancelAtPeriodEnd: false }
    : { cancelAtPeriodEnd: true };
}
