import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PaymentFailedEvent,
  SubscriptionActivatedEvent,
  SubscriptionCanceledEvent,
  SubscriptionPastDueEvent,
  SubscriptionRenewedEvent,
  UsagePeriodClosedEvent
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
 * Which side owns the subscription lifecycle (design §8): YooKassa is
 * self-managed (the core drives renewals), every other provider (Paddle) is
 * provider-managed.
 */
function lifecycleOwnerFor(provider: BillingProviderId): 'provider' | 'self' {
  return provider === 'yookassa' ? 'self' : 'provider';
}

/** Non-canceled subscription statuses a self-managed first payment can land on. */
const SELF_MANAGED_OPEN_STATUSES = [
  'incomplete',
  'trialing',
  'active',
  'past_due'
] as const;

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
          event.provider,
          event.type,
          event.payload as NormalizedSubscriptionPayload
        );
        break;
      case 'invoice.paid':
        await this.reduceInvoice(
          event.provider,
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
    provider: BillingProviderId,
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
      let closedPeriod: { start: Date; end: Date } | null = null;

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
          provider,
          billingMode: plan?.billingMode ?? 'fixed',
          status: payload.status,
          lifecycleOwner: lifecycleOwnerFor(provider),
          currentPeriodStart: parseDate(payload.currentPeriodStart, now),
          currentPeriodEnd: parseDate(payload.currentPeriodEnd, now),
          cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
          trialEnd: payload.trialEnd ? new Date(payload.trialEnd) : null,
          providerSubscriptionId: payload.providerSubscriptionId,
          paymentMethodId: null
        });
      } else {
        // A provider-managed usage subscription whose incoming snapshot starts
        // a new period at/after the stored boundary has just rolled over — the
        // stored period is closed and must be invoiced postpaid. Detected
        // before the snapshot is applied; a replayed snapshot no longer
        // advances anything, so it never re-detects.
        const incomingStart = payload.currentPeriodStart
          ? new Date(payload.currentPeriodStart)
          : null;
        if (
          subscription.billingMode === 'usage' &&
          subscription.lifecycleOwner === 'provider' &&
          incomingStart &&
          !Number.isNaN(incomingStart.getTime()) &&
          incomingStart.getTime() >= subscription.currentPeriodEnd.getTime()
        ) {
          closedPeriod = {
            start: subscription.currentPeriodStart,
            end: subscription.currentPeriodEnd
          };
        }

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
      return { subscriptionId: saved.id, userId, closedPeriod };
    });

    if (!result?.userId) {
      return;
    }
    this.emitSubscriptionEvent(type, result.userId, result.subscriptionId);
    if (result.closedPeriod) {
      this.events.emit(
        UsagePeriodClosedEvent.name,
        new UsagePeriodClosedEvent(
          result.userId,
          result.subscriptionId,
          result.closedPeriod.start,
          result.closedPeriod.end
        )
      );
    }
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
    provider: BillingProviderId,
    providerEventId: string,
    payload: NormalizedInvoicePayload
  ): Promise<void> {
    if (!payload.ref.customerId) {
      this.logger.warn(
        `Skipping invoice.paid ${payload.providerInvoiceRef}: no customer reference`
      );
      return;
    }
    const customerId = payload.ref.customerId;
    const selfManaged = lifecycleOwnerFor(provider) === 'self';

    const result = await withTransaction(this.dataSource, async (manager) => {
      const userId = await this.resolveUserId(manager, payload.ref);
      const now = new Date();

      // A postpaid usage charge round-trips its `usage:{sub}:{periodEnd}` key
      // through the provider's price custom data; the payment settles the
      // pending invoice the usage-invoicing listener planted instead of
      // inserting a second row.
      if (payload.usageChargeKey) {
        const reconciled = await manager.update(
          Invoice,
          { providerEventId: payload.usageChargeKey, status: 'pending' },
          {
            status: 'paid',
            providerInvoiceRef: payload.providerInvoiceRef,
            paidAt: parseDate(payload.paidAt, now)
          }
        );
        const invoice = await manager.findOne(Invoice, {
          where: { providerEventId: payload.usageChargeKey }
        });
        if (invoice) {
          // No pending row matched but the invoice exists — an already-settled
          // replay; never insert a duplicate alongside it.
          return reconciled.affected
            ? { invoiceId: invoice.id, userId, activatedSubscriptionId: null }
            : null;
        }
        // The keyed invoice vanished — fall through to the plain insert so the
        // payment is still recorded.
      }

      // Provider-managed invoices link by the provider subscription id; a
      // self-managed (YooKassa) first payment has none, so the incomplete
      // subscription created at checkout is found by customer id.
      const subscription = payload.providerSubscriptionId
        ? await manager.findOne(Subscription, {
            where: { providerSubscriptionId: payload.providerSubscriptionId }
          })
        : selfManaged
          ? await manager.findOne(Subscription, {
              where: {
                customerId,
                status: In([...SELF_MANAGED_OPEN_STATUSES])
              },
              order: { createdAt: 'DESC' }
            })
          : null;

      const insert = await manager
        .createQueryBuilder()
        .insert()
        .into(Invoice)
        .values({
          customerId,
          subscriptionId: subscription?.id ?? null,
          provider,
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

      // orIgnore returns no row on a replayed event — the unique
      // provider_event_id gates the whole reduce, so the activation below runs
      // exactly once per paid invoice.
      const rows = insert.raw as Array<{ id: string }>;
      if (rows.length === 0) {
        return null;
      }

      const activatedSubscriptionId =
        selfManaged && subscription
          ? await this.activateSelfManaged(manager, subscription, payload, now)
          : null;

      return { invoiceId: rows[0].id, userId, activatedSubscriptionId };
    });

    if (!result?.userId) {
      return;
    }
    this.events.emit(
      InvoicePaidEvent.name,
      new InvoicePaidEvent(result.userId, result.invoiceId)
    );
    if (result.activatedSubscriptionId) {
      this.events.emit(
        SubscriptionActivatedEvent.name,
        new SubscriptionActivatedEvent(
          result.userId,
          result.activatedSubscriptionId
        )
      );
    }
  }

  /**
   * Self-managed first-payment activation (design §8.2): persist the saved card
   * as the customer's default `PaymentMethod`, point the subscription at it, and
   * flip it out of `incomplete` (to `trialing` while a trial is still running,
   * else `active`). Idempotency is guaranteed by the caller's invoice insert.
   */
  private async activateSelfManaged(
    manager: EntityManager,
    subscription: Subscription,
    payload: NormalizedInvoicePayload,
    now: Date
  ): Promise<string> {
    if (payload.savedPaymentMethod) {
      const method = await manager.save(
        manager.create(PaymentMethod, {
          customerId: subscription.customerId,
          provider: subscription.provider,
          providerMethodRef: payload.savedPaymentMethod.providerMethodRef,
          brand: payload.savedPaymentMethod.brand,
          last4: payload.savedPaymentMethod.last4,
          isDefault: true
        })
      );
      subscription.paymentMethodId = method.id;
      await manager.update(
        Customer,
        { id: subscription.customerId },
        { defaultPaymentMethodId: method.id }
      );
    }

    const trialing =
      subscription.trialEnd != null &&
      subscription.trialEnd.getTime() > now.getTime();
    subscription.status = trialing ? 'trialing' : 'active';
    await manager.save(subscription);
    return subscription.id;
  }

  private async reducePaymentFailed(
    payload: NormalizedPaymentFailedPayload
  ): Promise<void> {
    // A failed postpaid usage charge surfaces on its pending invoice; the
    // subscription stays as the provider reports it (Paddle owns dunning).
    if (payload.usageChargeKey) {
      await this.dataSource.manager.update(
        Invoice,
        { providerEventId: payload.usageChargeKey, status: 'pending' },
        { status: 'failed' }
      );
    }

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
