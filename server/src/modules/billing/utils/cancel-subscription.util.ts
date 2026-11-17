import type { EventEmitter2 } from '@nestjs/event-emitter';
import { In, type Repository } from 'typeorm';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  OPEN_SUBSCRIPTION_STATUSES
} from '@app/shared/constants';
import type { CancelMode } from '@app/shared/types';
import {
  ALREADY_CANCELED,
  type CancelRefusal,
  cancelRefusal
} from '@app/shared/utils/billing-rules';
import type { BillingService } from '../billing.service';
import type { Subscription } from '../entities/subscription.entity';
import {
  SubscriptionCancelScheduledEvent,
  SubscriptionCanceledEvent
} from '../events/billing.events';
import { cancelFields } from './cancel-fields.util';
import { ApiError } from '../../../common/errors/api-error';

function refusalError({ errorKey, message }: CancelRefusal): ApiError {
  return new ApiError(errorKey, message);
}

/** What the cancel tail needs from whichever service is running it. */
export interface CancelSubscriptionDeps {
  subscriptions: Repository<Subscription>;
  billing: BillingService;
  events: EventEmitter2;
}

/**
 * The half of a cancellation the self-service and the admin route share: ask the
 * provider, write only the cancel columns, re-read, and emit on an immediate
 * cancel. The two callers differ solely in how they find the row (caller-scoped
 * vs by id) and how they name its owner, so both are passed in.
 *
 * Both ends are guarded, mirroring `RenewalService`: the pre-check keeps a
 * canceled or already scheduled row from reaching the provider a second time,
 * and the predicate on the write is what makes a cancel that lands during the
 * provider round-trip lose instead of overwriting it. Without them a repeat
 * cancel re-runs the whole flow — a second provider call, a second event, and a
 * second audit row — and a `period_end` repeat leaves `canceled` together with
 * `cancelAtPeriodEnd`, a pair no other writer can produce.
 */
export async function cancelOpenSubscription(
  deps: CancelSubscriptionDeps,
  subscription: Subscription,
  {
    mode,
    resolveUserId
  }: {
    mode: CancelMode;
    resolveUserId: (subscription: Subscription) => Promise<string | null>;
  }
): Promise<Subscription> {
  const refusal = cancelRefusal(subscription, mode);

  if (refusal) {
    throw refusalError(refusal);
  }

  // Read before the write: an immediate cancel of an unpaid `incomplete` row
  // ends no access, so it gets no notice of an end.
  const endedAccess = ENTITLED_SUBSCRIPTION_STATUSES.includes(
    subscription.status
  );

  // Provider-managed lifecycle: ask the provider to cancel; the resulting
  // webhook reconciles status. Self-managed: there is no provider object — the
  // renewal scheduler simply stops charging the saved card.
  if (subscription.providerSubscriptionId) {
    await deps.billing
      .getProviderById(subscription.provider)
      .cancel(subscription.providerSubscriptionId, mode);
  }

  const fields = cancelFields(mode);
  const predicate =
    mode === 'immediate'
      ? { id: subscription.id, status: In([...OPEN_SUBSCRIPTION_STATUSES]) }
      : {
          id: subscription.id,
          status: In([...ENTITLED_SUBSCRIPTION_STATUSES]),
          cancelAtPeriodEnd: false
        };
  const applied = await deps.subscriptions.update(predicate, fields);

  if (applied.affected !== 1) {
    // A concurrent writer won: name what it did, not what this call wanted.
    const current = await deps.subscriptions.findOne({
      where: { id: subscription.id }
    });

    throw refusalError(
      (current && cancelRefusal(current, mode)) ?? ALREADY_CANCELED
    );
  }

  Object.assign(subscription, fields);
  const saved =
    (await deps.subscriptions.findOne({ where: { id: subscription.id } })) ??
    subscription;

  const userId = await resolveUserId(saved);

  if (!userId) return saved;

  // Immediate cancellation revokes access now, so the cached entitlements must
  // be invalidated; a period-end cancel keeps access until the period closes
  // and only tells the user the last day.
  if (mode === 'immediate') {
    deps.events.emit(
      SubscriptionCanceledEvent.name,
      new SubscriptionCanceledEvent(userId, saved.id, endedAccess)
    );
  } else {
    deps.events.emit(
      SubscriptionCancelScheduledEvent.name,
      new SubscriptionCancelScheduledEvent(userId, saved.id)
    );
  }

  return saved;
}
