import type { Subscription } from './subscription.entity';
import type { SubscriptionResponse, _AssertNever } from '@app/shared/types';

/**
 * Provider reference, internal dunning state, the billing anchor, the start of
 * the metered window and its ingest seal, and the concurrency token and lease,
 * all @Exclude()-d from the wire.
 */
type _ExcludedFields =
  | 'providerSubscriptionId'
  | 'dunningAttempts'
  | 'nextRenewalAttemptAt'
  | 'billingAnchorAt'
  | 'meteredFrom'
  | 'usageSealedUntil'
  | 'version'
  | 'planChangeSeq'
  | 'planChangeStartedAt';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Subscription, keyof SubscriptionResponse | _ExcludedFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof SubscriptionResponse, keyof Subscription>
>;
