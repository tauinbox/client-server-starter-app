import { ConflictException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { In, type Repository } from 'typeorm';
import {
  OPEN_SUBSCRIPTION_STATUSES,
  isOpenStatus
} from '@app/shared/constants';
import type { BillingService } from '../billing.service';
import type { Subscription } from '../entities/subscription.entity';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import type { CancelMode } from '../providers/payment-provider.interface';
import type { RenewalService } from '../renewals/renewal.service';
import { cancelFields } from './cancel-fields.util';

export const ALREADY_CANCELED_MESSAGE =
  'This subscription is already canceled.';

/** What the cancel tail needs from whichever service is running it. */
export interface CancelSubscriptionDeps {
  subscriptions: Repository<Subscription>;
  billing: BillingService;
  renewals: RenewalService;
  events: EventEmitter2;
}

/**
 * The half of a cancellation the self-service and the admin route share: ask the
 * provider, write only the cancel columns, re-read, and emit on an immediate
 * cancel. The two callers differ solely in how they find the row (caller-scoped
 * vs by id) and how they name its owner, so both are passed in.
 *
 * Both ends are guarded on an open status, mirroring `RenewalService`: the
 * pre-check keeps a canceled row from reaching the provider a second time, and
 * the predicate on the write is what makes a cancel that lands during the
 * provider round-trip lose instead of overwriting it. Without them a repeat
 * cancel re-runs the whole flow — a second provider call, a second event, and a
 * second audit row — and a `period_end` repeat leaves `canceled` together with
 * `cancelAtPeriodEnd`, a pair no other writer can produce.
 */
export async function cancelOpenSubscription(
  deps: CancelSubscriptionDeps,
  subscription: Subscription,
  mode: CancelMode,
  resolveUserId: (subscription: Subscription) => Promise<string | null>
): Promise<Subscription> {
  if (!isOpenStatus(subscription.status)) {
    throw new ConflictException(ALREADY_CANCELED_MESSAGE);
  }

  // Provider-managed lifecycle: ask the provider to cancel; the resulting
  // webhook reconciles status. Self-managed: there is no provider object — the
  // renewal scheduler simply stops charging the saved card.
  if (subscription.providerSubscriptionId) {
    const provider = deps.billing.getProviderById(subscription.provider);
    if (provider) {
      await provider.cancel(subscription.providerSubscriptionId, mode);
    }
  }

  // Ending a metered period now means its postpaid units are owed now: they are
  // rated and charged before the row closes. A period-end cancel leaves that to
  // the renewal scan, which reaches the boundary with the period still open.
  if (mode === 'immediate') {
    await deps.renewals.billClosingUsagePeriod(subscription);
  }

  const fields = cancelFields(mode);
  const applied = await deps.subscriptions.update(
    { id: subscription.id, status: In([...OPEN_SUBSCRIPTION_STATUSES]) },
    fields
  );
  if (applied.affected !== 1) {
    throw new ConflictException(ALREADY_CANCELED_MESSAGE);
  }

  Object.assign(subscription, fields);
  const saved =
    (await deps.subscriptions.findOne({ where: { id: subscription.id } })) ??
    subscription;

  // Immediate cancellation revokes access now, so the cached entitlements must
  // be invalidated; a period-end cancel keeps access until the period closes.
  if (mode === 'immediate') {
    const userId = await resolveUserId(saved);
    if (userId) {
      deps.events.emit(
        SubscriptionCanceledEvent.name,
        new SubscriptionCanceledEvent(userId, saved.id)
      );
    }
  }
  return saved;
}
