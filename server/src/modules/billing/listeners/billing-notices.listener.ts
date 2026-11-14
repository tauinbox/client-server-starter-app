import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UserNotificationContent } from '@app/shared/types';
import { renewalAnchor } from '@app/shared/utils/billing-rules';
import { UserNotificationsService } from '../../notifications/user-notifications.service';
import { Invoice } from '../entities/invoice.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  CreditBalanceCrossedEvent,
  InvoicePaidEvent,
  PaymentFailedEvent,
  RefundIssuedEvent,
  SubscriptionCancelScheduledEvent,
  SubscriptionCanceledEvent
} from '../events/billing.events';

/**
 * Turns the billing events into stored notices for the user. Each handler
 * runs after the commit that emitted its event, and a failure here is only
 * logged: a notice never blocks or reverts the money operation.
 */
@Injectable()
export class BillingNoticesListener {
  private readonly logger = new Logger(BillingNoticesListener.name);

  constructor(
    private readonly notices: UserNotificationsService,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>
  ) {}

  @OnEvent(InvoicePaidEvent.name)
  async onInvoicePaid({ userId, invoiceId }: InvoicePaidEvent): Promise<void> {
    await this.notify(userId, async () => {
      const invoice = await this.invoices.findOne({ where: { id: invoiceId } });
      const amountMinor = invoice?.amountMinor.toNumber() ?? 0;

      // A zero invoice (a free plan, a trial binding) moved no money.
      if (!invoice || amountMinor === 0) return null;

      return {
        kind: 'invoice_paid',
        payload: { invoiceId, amountMinor, currency: invoice.currency }
      };
    });
  }

  @OnEvent(PaymentFailedEvent.name)
  async onPaymentFailed({
    userId,
    subscriptionId
  }: PaymentFailedEvent): Promise<void> {
    await this.notify(userId, async () => {
      const subscription = subscriptionId
        ? await this.subscriptions.findOne({ where: { id: subscriptionId } })
        : null;

      return {
        kind: 'payment_failed',
        payload: {
          subscriptionId: subscription?.id ?? null,
          planName: subscription ? await this.planName(subscription) : null,
          subscriptionStatus: subscription?.status ?? null,
          nextAttemptAt:
            subscription?.nextRenewalAttemptAt?.toISOString() ?? null
        }
      };
    });
  }

  @OnEvent(SubscriptionCancelScheduledEvent.name)
  async onCancelScheduled({
    userId,
    subscriptionId
  }: SubscriptionCancelScheduledEvent): Promise<void> {
    await this.notify(userId, async () => {
      const subscription = await this.subscriptions.findOne({
        where: { id: subscriptionId }
      });

      // A later writer can end the row or take the schedule back first.
      if (
        !subscription?.cancelAtPeriodEnd ||
        subscription.status === 'canceled'
      )
        return null;

      return {
        kind: 'subscription_cancel_scheduled',
        payload: {
          subscriptionId,
          planName: await this.planName(subscription),
          accessEndsAt: renewalAnchor(subscription).toISOString()
        }
      };
    });
  }

  @OnEvent(SubscriptionCanceledEvent.name)
  async onCanceled({
    userId,
    subscriptionId
  }: SubscriptionCanceledEvent): Promise<void> {
    await this.notify(userId, async () => {
      const subscription = await this.subscriptions.findOne({
        where: { id: subscriptionId }
      });

      if (!subscription) return null;

      return {
        kind: 'subscription_canceled',
        payload: {
          subscriptionId,
          planName: await this.planName(subscription)
        }
      };
    });
  }

  @OnEvent(RefundIssuedEvent.name)
  async onRefundIssued({
    userId,
    invoiceId,
    amount
  }: RefundIssuedEvent): Promise<void> {
    await this.notify(userId, () =>
      Promise.resolve({
        kind: 'refund_issued',
        payload: { invoiceId, ...amount }
      })
    );
  }

  @OnEvent(CreditBalanceCrossedEvent.name)
  async onCreditBalanceCrossed({
    userId,
    balanceAfter
  }: CreditBalanceCrossedEvent): Promise<void> {
    if (balanceAfter > 0) return;

    await this.notify(userId, () =>
      Promise.resolve({ kind: 'credit_balance_depleted', payload: {} })
    );
  }

  private async planName(subscription: Subscription): Promise<string> {
    const plan = await this.plans.findOne({
      where: { key: subscription.planKey },
      select: { name: true }
    });

    return plan?.name ?? subscription.planKey;
  }

  private async notify(
    userId: string,
    build: () => Promise<UserNotificationContent | null>
  ): Promise<void> {
    try {
      const content = await build();

      if (content) {
        await this.notices.notify(userId, content);
      }
    } catch (error) {
      this.logger.error(
        `Failed to store a billing notice for user ${userId}`,
        error as Error
      );
    }
  }
}
