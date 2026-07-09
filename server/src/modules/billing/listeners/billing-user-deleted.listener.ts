import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';
import { Customer } from '../entities/customer.entity';
import { Subscription } from '../entities/subscription.entity';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from '../providers/payment-provider.interface';

/**
 * Cancels a deleted user's subscriptions: provider-managed ones at their
 * provider, self-managed ones (no provider-side subscription) locally, so the
 * renewal scheduler stops charging the deleted user's saved payment method.
 * Additive to the existing `UserDeletedEvent` consumers (notifications, auth,
 * feature-flags); those are untouched. Best-effort: a failure is logged, never
 * thrown, so account deletion cannot be blocked by a billing call.
 */
@Injectable()
export class BillingUserDeletedListener {
  private readonly logger = new Logger(BillingUserDeletedListener.name);

  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @Inject(BILLING_PROVIDERS)
    private readonly providers: PaymentProvider[],
    private readonly events: EventEmitter2
  ) {}

  @OnEvent(UserDeletedEvent.name)
  async handleUserDeleted(event: UserDeletedEvent): Promise<void> {
    const customer = await this.customers.findOne({
      where: { userId: event.userId }
    });
    if (!customer) return;

    const subscriptions = await this.subscriptions.find({
      where: { customerId: customer.id }
    });

    for (const subscription of subscriptions) {
      if (subscription.status === 'canceled') continue;

      if (!subscription.providerSubscriptionId) {
        await this.cancelLocally(subscription, event.userId);
        continue;
      }
      const provider = this.providers.find(
        (p) => p.id === subscription.provider
      );
      if (!provider) continue;

      try {
        await provider.cancel(subscription.providerSubscriptionId, 'immediate');
      } catch (err) {
        this.logger.error(
          `Failed to cancel subscription ${subscription.id} at provider ${subscription.provider} for deleted user ${event.userId}`,
          err instanceof Error ? err.stack : String(err)
        );
      }
    }
  }

  private async cancelLocally(
    subscription: Subscription,
    userId: string
  ): Promise<void> {
    try {
      subscription.status = 'canceled';
      subscription.cancelAtPeriodEnd = false;
      subscription.nextRenewalAttemptAt = null;
      await this.subscriptions.save(subscription);
      this.events.emit(
        SubscriptionCanceledEvent.name,
        new SubscriptionCanceledEvent(userId, subscription.id)
      );
    } catch (err) {
      this.logger.error(
        `Failed to locally cancel self-managed subscription ${subscription.id} for deleted user ${userId}`,
        err instanceof Error ? err.stack : String(err)
      );
    }
  }
}
