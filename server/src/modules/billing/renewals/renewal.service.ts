import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PaymentFailedEvent,
  SubscriptionCanceledEvent,
  SubscriptionPastDueEvent,
  SubscriptionRenewedEvent
} from '../events/billing.events';
import {
  BILLING_PROVIDERS,
  type ChargeResult,
  type PaymentProvider
} from '../providers/payment-provider.interface';
import { FixedRating } from '../rating/fixed-rating.strategy';
import type { RatedAmount } from '../rating/rating-strategy.interface';
import { addInterval } from '../utils/period.util';
import {
  DUNNING_MAX_ATTEMPTS,
  DUNNING_RETRY_DELAY_MS
} from './renewal-queue.constants';

/**
 * Drives the self-managed (YooKassa) subscription lifecycle the core owns
 * (design §8.2): each scan charges the saved card off-session for every due
 * subscription, advances the period on success, and on failure walks the dunning
 * ladder (`past_due` → retries → `canceled`). Provider-managed (Paddle)
 * subscriptions are skipped — their renewals arrive as webhooks.
 *
 * Safety against double charges and multi-instance / replayed scans rests on two
 * idempotency layers, not row locks: the per-attempt `Idempotence-Key` the
 * provider honours, and the unique `provider_event_id` on the renewal `Invoice`
 * (set to that same key) which gates the period advance to exactly once.
 */
@Injectable()
export class RenewalService {
  private readonly logger = new Logger(RenewalService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(BILLING_PROVIDERS)
    private readonly providers: PaymentProvider[],
    private readonly fixedRating: FixedRating,
    private readonly events: EventEmitter2
  ) {}

  /** Processes every due self-managed subscription; one failure never aborts the rest. */
  async runDueRenewals(now: Date = new Date()): Promise<void> {
    const due = await this.findDue(now);
    for (const subscription of due) {
      try {
        await this.processSubscription(subscription.id, now);
      } catch (error) {
        this.logger.error(
          `Renewal processing failed for subscription ${subscription.id}`,
          error as Error
        );
      }
    }
  }

  /**
   * Self-managed subscriptions past their due moment: a trial reaching
   * `trial_end`, an active period reaching `current_period_end`, or a `past_due`
   * one reaching its next dunning retry. Usage-mode renewals are charged with the
   * usage subsystem, so only fixed tiers are swept here.
   */
  private findDue(now: Date): Promise<Subscription[]> {
    return this.subscriptions
      .createQueryBuilder('s')
      .where('s.lifecycleOwner = :owner', { owner: 'self' })
      .andWhere('s.billingMode = :mode', { mode: 'fixed' })
      .andWhere(
        new Brackets((qb) => {
          qb.where('s.status = :trialing AND s.trialEnd <= :now')
            .orWhere('s.status = :active AND s.currentPeriodEnd <= :now')
            .orWhere(
              's.status = :pastDue AND s.nextRenewalAttemptAt IS NOT NULL AND s.nextRenewalAttemptAt <= :now'
            );
        })
      )
      .setParameters({
        now,
        trialing: 'trialing',
        active: 'active',
        pastDue: 'past_due'
      })
      .orderBy('s.currentPeriodEnd', 'ASC')
      .getMany();
  }

  private async processSubscription(id: string, now: Date): Promise<void> {
    const subscription = await this.subscriptions.findOne({ where: { id } });
    if (!subscription) return;

    const dueAt = this.dueAt(subscription);
    if (!dueAt || dueAt.getTime() > now.getTime()) {
      // Another instance already advanced it, or it is no longer due.
      return;
    }

    const customer = await this.customers.findOne({
      where: { id: subscription.customerId }
    });
    const plan = await this.plans.findOne({
      where: { key: subscription.planKey }
    });
    if (!customer || !plan) {
      this.logger.warn(
        `Skipping renewal for subscription ${id}: missing customer or plan`
      );
      return;
    }

    // Cancel-at-period-end: stop at the boundary instead of charging again.
    if (subscription.cancelAtPeriodEnd) {
      await this.cancelAtPeriodEnd(subscription, customer.userId);
      return;
    }

    const provider = this.providers.find((p) => p.id === subscription.provider);
    if (!provider) {
      this.logger.error(
        `Subscription ${id} references unregistered provider ${subscription.provider}`
      );
      return;
    }

    // The new period starts at the boundary that fell due — a trial converts
    // from trial_end, a renewal extends from the current period end — never from
    // wall-clock now, so periods stay contiguous even if a scan runs late.
    const anchor =
      subscription.status === 'trialing' && subscription.trialEnd
        ? subscription.trialEnd
        : subscription.currentPeriodEnd;
    const rated = this.fixedRating.amountForPeriod(subscription, plan);
    const idempotencyKey = `renewal:${subscription.id}:${anchor.getTime()}:${subscription.dunningAttempts}`;

    let charge: ChargeResult;
    try {
      charge = await provider.chargeOffSession(
        customer,
        rated.amountMinor,
        rated.receiptItems,
        idempotencyKey
      );
    } catch (error) {
      this.logger.warn(
        `Renewal charge failed for subscription ${id}: ${(error as Error).message}`
      );
      await this.handleFailure(subscription, customer.userId, now);
      return;
    }

    await this.handleSuccess(
      subscription,
      customer,
      plan,
      rated,
      charge,
      anchor,
      idempotencyKey,
      now
    );
  }

  /** The moment a subscription is due for its next self-managed charge. */
  private dueAt(subscription: Subscription): Date | null {
    if (subscription.status === 'trialing') return subscription.trialEnd;
    if (subscription.status === 'past_due')
      return subscription.nextRenewalAttemptAt;
    if (subscription.status === 'active') return subscription.currentPeriodEnd;
    return null;
  }

  private async handleSuccess(
    subscription: Subscription,
    customer: Customer,
    plan: Plan,
    rated: RatedAmount,
    charge: ChargeResult,
    anchor: Date,
    idempotencyKey: string,
    now: Date
  ): Promise<void> {
    const newPeriodStart = anchor;
    const newPeriodEnd = addInterval(anchor, plan.interval);

    const result = await withTransaction(this.dataSource, async (manager) => {
      const insert = await manager
        .createQueryBuilder()
        .insert()
        .into(Invoice)
        .values({
          customerId: subscription.customerId,
          subscriptionId: subscription.id,
          provider: subscription.provider,
          providerEventId: idempotencyKey,
          providerInvoiceRef: charge.providerInvoiceRef,
          amountMinor: rated.amountMinor,
          currency: customer.currency,
          status: 'paid',
          billingMode: subscription.billingMode,
          periodStart: newPeriodStart,
          periodEnd: newPeriodEnd,
          paidAt: now,
          receiptRef: null
        })
        .orIgnore()
        .returning(['id'])
        .execute();

      // orIgnore returns no row when this exact attempt's invoice already
      // exists — the period was already advanced, so this replay is a no-op.
      const rows = insert.raw as Array<{ id: string }>;
      if (rows.length === 0) return null;

      const fresh = await manager.findOne(Subscription, {
        where: { id: subscription.id }
      });
      if (!fresh) return null;
      fresh.status = 'active';
      fresh.currentPeriodStart = newPeriodStart;
      fresh.currentPeriodEnd = newPeriodEnd;
      fresh.trialEnd = null;
      fresh.dunningAttempts = 0;
      fresh.nextRenewalAttemptAt = null;
      await manager.save(fresh);

      return { invoiceId: rows[0].id };
    });

    if (!result) return;
    this.events.emit(
      InvoicePaidEvent.name,
      new InvoicePaidEvent(customer.userId, result.invoiceId)
    );
    this.events.emit(
      SubscriptionRenewedEvent.name,
      new SubscriptionRenewedEvent(customer.userId, subscription.id)
    );
  }

  private async handleFailure(
    subscription: Subscription,
    userId: string,
    now: Date
  ): Promise<void> {
    const result = await withTransaction(this.dataSource, async (manager) => {
      const fresh = await manager.findOne(Subscription, {
        where: { id: subscription.id }
      });
      if (!fresh) return null;

      const attempts = fresh.dunningAttempts + 1;
      fresh.dunningAttempts = attempts;

      if (attempts >= DUNNING_MAX_ATTEMPTS) {
        fresh.status = 'canceled';
        fresh.cancelAtPeriodEnd = false;
        fresh.nextRenewalAttemptAt = null;
        await manager.save(fresh);
        return { canceled: true };
      }

      fresh.status = 'past_due';
      fresh.nextRenewalAttemptAt = new Date(
        now.getTime() + DUNNING_RETRY_DELAY_MS
      );
      await manager.save(fresh);
      return { canceled: false };
    });

    if (!result) return;
    this.events.emit(
      PaymentFailedEvent.name,
      new PaymentFailedEvent(userId, subscription.id)
    );
    if (result.canceled) {
      this.events.emit(
        SubscriptionCanceledEvent.name,
        new SubscriptionCanceledEvent(userId, subscription.id)
      );
    } else {
      this.events.emit(
        SubscriptionPastDueEvent.name,
        new SubscriptionPastDueEvent(userId, subscription.id)
      );
    }
  }

  private async cancelAtPeriodEnd(
    subscription: Subscription,
    userId: string
  ): Promise<void> {
    subscription.status = 'canceled';
    subscription.nextRenewalAttemptAt = null;
    await this.subscriptions.save(subscription);
    this.events.emit(
      SubscriptionCanceledEvent.name,
      new SubscriptionCanceledEvent(userId, subscription.id)
    );
  }
}
