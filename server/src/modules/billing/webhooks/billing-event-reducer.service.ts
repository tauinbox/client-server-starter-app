import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PaymentFailedEvent,
  SubscriptionActivatedEvent,
  SubscriptionCanceledEvent,
  SubscriptionPastDueEvent,
  SubscriptionRenewedEvent
} from '../events/billing.events';
import type {
  NormalizedCustomerRef,
  NormalizedEvent,
  NormalizedInvoicePayload,
  NormalizedPaymentFailedPayload,
  NormalizedSubscriptionPayload
} from '../providers/payment-provider.interface';

/** Parses an ISO timestamp, falling back to `fallback` when absent/invalid. */
function parseDate(iso: string | null, fallback: Date): Date {
  if (!iso) {
    return fallback;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

/**
 * Reduces a verified, provider-agnostic `NormalizedEvent` onto our
 * `Subscription`/`Invoice` rows inside a single transaction, then emits the
 * matching billing domain event (after commit, so listeners observe committed
 * state). Idempotency at the event level is guaranteed upstream by the
 * `billing_webhook_events` unique key; within a delivery the subscription upsert
 * and the unique `provider_event_id` on `Invoice` keep re-application safe.
 */
@Injectable()
export class BillingEventReducer {
  private readonly logger = new Logger(BillingEventReducer.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: EventEmitter2
  ) {}

  async reduce(event: NormalizedEvent): Promise<void> {
    switch (event.type) {
      case 'subscription.activated':
      case 'subscription.renewed':
      case 'subscription.past_due':
      case 'subscription.canceled':
        await this.reduceSubscription(
          event.type,
          event.payload as NormalizedSubscriptionPayload
        );
        break;
      case 'invoice.paid':
        await this.reduceInvoice(
          event.providerEventId,
          event.payload as NormalizedInvoicePayload
        );
        break;
      case 'payment.failed':
        await this.reducePaymentFailed(
          event.payload as NormalizedPaymentFailedPayload
        );
        break;
      case 'subscription.plan_changed':
        // Plan changes are applied by the M3 change flow.
        break;
    }
  }

  private async resolveUserId(
    manager: EntityManager,
    ref: NormalizedCustomerRef
  ): Promise<string | null> {
    if (ref.userId) {
      return ref.userId;
    }
    if (!ref.customerId) {
      return null;
    }
    const customer = await manager.findOne(Customer, {
      where: { id: ref.customerId }
    });
    return customer?.userId ?? null;
  }

  private async reduceSubscription(
    type:
      | 'subscription.activated'
      | 'subscription.renewed'
      | 'subscription.past_due'
      | 'subscription.canceled',
    payload: NormalizedSubscriptionPayload
  ): Promise<void> {
    if (!payload.ref.customerId) {
      this.logger.warn(
        `Skipping ${type} for ${payload.providerSubscriptionId}: no customer reference`
      );
      return;
    }

    const result = await withTransaction(this.dataSource, async (manager) => {
      const userId = await this.resolveUserId(manager, payload.ref);
      const now = new Date();

      let subscription = await manager.findOne(Subscription, {
        where: { providerSubscriptionId: payload.providerSubscriptionId }
      });

      if (!subscription) {
        if (!payload.planKey) {
          this.logger.warn(
            `Skipping ${type} for ${payload.providerSubscriptionId}: no plan key`
          );
          return null;
        }
        const plan = await manager.findOne(Plan, {
          where: { key: payload.planKey }
        });
        subscription = manager.create(Subscription, {
          customerId: payload.ref.customerId,
          planKey: payload.planKey,
          provider: 'paddle',
          billingMode: plan?.billingMode ?? 'fixed',
          status: payload.status,
          lifecycleOwner: 'provider',
          currentPeriodStart: parseDate(payload.currentPeriodStart, now),
          currentPeriodEnd: parseDate(payload.currentPeriodEnd, now),
          cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
          trialEnd: payload.trialEnd ? new Date(payload.trialEnd) : null,
          providerSubscriptionId: payload.providerSubscriptionId,
          paymentMethodId: null
        });
      } else {
        subscription.status = payload.status;
        subscription.cancelAtPeriodEnd = payload.cancelAtPeriodEnd;
        if (payload.planKey) {
          subscription.planKey = payload.planKey;
        }
        if (payload.currentPeriodStart) {
          subscription.currentPeriodStart = new Date(
            payload.currentPeriodStart
          );
        }
        if (payload.currentPeriodEnd) {
          subscription.currentPeriodEnd = new Date(payload.currentPeriodEnd);
        }
        subscription.trialEnd = payload.trialEnd
          ? new Date(payload.trialEnd)
          : null;
      }

      const saved = await manager.save(subscription);
      return { subscriptionId: saved.id, userId };
    });

    if (!result?.userId) {
      return;
    }
    this.emitSubscriptionEvent(type, result.userId, result.subscriptionId);
  }

  private emitSubscriptionEvent(
    type:
      | 'subscription.activated'
      | 'subscription.renewed'
      | 'subscription.past_due'
      | 'subscription.canceled',
    userId: string,
    subscriptionId: string
  ): void {
    switch (type) {
      case 'subscription.activated':
        this.events.emit(
          SubscriptionActivatedEvent.name,
          new SubscriptionActivatedEvent(userId, subscriptionId)
        );
        break;
      case 'subscription.renewed':
        this.events.emit(
          SubscriptionRenewedEvent.name,
          new SubscriptionRenewedEvent(userId, subscriptionId)
        );
        break;
      case 'subscription.past_due':
        this.events.emit(
          SubscriptionPastDueEvent.name,
          new SubscriptionPastDueEvent(userId, subscriptionId)
        );
        break;
      case 'subscription.canceled':
        this.events.emit(
          SubscriptionCanceledEvent.name,
          new SubscriptionCanceledEvent(userId, subscriptionId)
        );
        break;
    }
  }

  private async reduceInvoice(
    providerEventId: string,
    payload: NormalizedInvoicePayload
  ): Promise<void> {
    if (!payload.ref.customerId) {
      this.logger.warn(
        `Skipping invoice.paid ${payload.providerInvoiceRef}: no customer reference`
      );
      return;
    }

    const result = await withTransaction(this.dataSource, async (manager) => {
      const userId = await this.resolveUserId(manager, payload.ref);
      const now = new Date();

      const subscription = payload.providerSubscriptionId
        ? await manager.findOne(Subscription, {
            where: { providerSubscriptionId: payload.providerSubscriptionId }
          })
        : null;

      const insert = await manager
        .createQueryBuilder()
        .insert()
        .into(Invoice)
        .values({
          customerId: payload.ref.customerId,
          subscriptionId: subscription?.id ?? null,
          provider: 'paddle',
          providerEventId,
          providerInvoiceRef: payload.providerInvoiceRef,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          status: 'paid',
          billingMode: subscription?.billingMode ?? 'fixed',
          periodStart: parseDate(payload.periodStart, now),
          periodEnd: parseDate(payload.periodEnd, now),
          paidAt: parseDate(payload.paidAt, now),
          receiptRef: null
        })
        .orIgnore()
        .returning(['id'])
        .execute();

      const rows = insert.raw as Array<{ id: string }>;
      return rows.length > 0 ? { invoiceId: rows[0].id, userId } : null;
    });

    if (!result?.userId) {
      return;
    }
    this.events.emit(
      InvoicePaidEvent.name,
      new InvoicePaidEvent(result.userId, result.invoiceId)
    );
  }

  private async reducePaymentFailed(
    payload: NormalizedPaymentFailedPayload
  ): Promise<void> {
    const userId = await withTransaction(this.dataSource, (manager) =>
      this.resolveUserId(manager, payload.ref)
    );
    if (!userId) {
      return;
    }

    const subscription = payload.providerSubscriptionId
      ? await this.dataSource.manager.findOne(Subscription, {
          where: { providerSubscriptionId: payload.providerSubscriptionId }
        })
      : null;

    this.events.emit(
      PaymentFailedEvent.name,
      new PaymentFailedEvent(userId, subscription?.id ?? null)
    );
  }
}
