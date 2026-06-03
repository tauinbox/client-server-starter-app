import type { Subscription } from './subscription.entity';
import type { SubscriptionResponse, _AssertNever } from '@app/shared/types';

/** Provider subscription reference, @Exclude()-d from the wire format. */
type _ExcludedFields = 'providerSubscriptionId';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Subscription, keyof SubscriptionResponse | _ExcludedFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof SubscriptionResponse, keyof Subscription>
>;
