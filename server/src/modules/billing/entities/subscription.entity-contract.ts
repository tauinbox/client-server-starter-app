import type { Subscription } from './subscription.entity';
import type { SubscriptionResponse, _AssertNever } from '@app/shared/types';

/** Provider reference + internal dunning state, @Exclude()-d from the wire. */
type _ExcludedFields =
  | 'providerSubscriptionId'
  | 'dunningAttempts'
  | 'nextRenewalAttemptAt';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Subscription, keyof SubscriptionResponse | _ExcludedFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof SubscriptionResponse, keyof Subscription>
>;
