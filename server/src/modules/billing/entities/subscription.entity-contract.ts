import type { Subscription } from './subscription.entity';
import type { SubscriptionResponse, _AssertNever } from '@app/shared/types';

/**
 * Provider reference, internal dunning state, the billing anchor, the
 * concurrency token and lease, and the renewal notice marker, all
 * @Exclude()-d from the wire.
 */
type _ExcludedFields =
  | 'providerSubscriptionId'
  | 'dunningAttempts'
  | 'nextRenewalAttemptAt'
  | 'billingAnchorAt'
  | 'version'
  | 'planChangeSeq'
  | 'planChangeStartedAt'
  | 'renewalNoticeFor';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Subscription, keyof SubscriptionResponse | _ExcludedFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof SubscriptionResponse, keyof Subscription>
>;
