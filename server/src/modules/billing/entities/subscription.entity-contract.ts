import type { Subscription } from './subscription.entity';
import type { SubscriptionResponse, _AssertNever } from '@app/shared/types';

/**
 * Provider reference, internal dunning state, and the concurrency token,
 * all @Exclude()-d from the wire.
 */
type _ExcludedFields =
  | 'providerSubscriptionId'
  | 'dunningAttempts'
  | 'nextRenewalAttemptAt'
  | 'version';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Subscription, keyof SubscriptionResponse | _ExcludedFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof SubscriptionResponse, keyof Subscription>
>;
