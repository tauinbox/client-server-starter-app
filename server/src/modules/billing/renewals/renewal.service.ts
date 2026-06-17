import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { Money } from '@app/shared/utils/money';
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
import { UsageRating } from '../rating/usage-rating.strategy';
import type { RatedAmount } from '../rating/rating-strategy.interface';
import { CreditService } from '../services/credit.service';
import { addInterval } from '../utils/period.util';
import {
  DUNNING_MAX_ATTEMPTS,
  DUNNING_RETRY_DELAY_MS
} from './renewal-queue.constants';

/**
 * Drives the self-managed (YooKassa) subscription lifecycle the core owns:
 * each scan charges the saved card off-session for every due
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
    private readonly usageRating: UsageRating,
    private readonly credits: CreditService,
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
   * one reaching its next dunning retry. Both rating modes are swept — fixed
   * tiers prepay the next period, usage tiers postpay the one that just ended.
   */
  private findDue(now: Date): Promise<Subscription[]> {
    return this.subscriptions
      .createQueryBuilder('s')
      .where('s.lifecycleOwner = :owner', { owner: 'self' })
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
    // Fixed prepays the upcoming period; usage postpays the one ending at the
    // anchor, rated over [currentPeriodStart, anchor) with prepaid credits
    // offsetting billable units before money is charged — the balance is read
    // here and deducted only when the invoice insert wins. The rated receipt
    // items ride into the provider's 54-FZ receipt unchanged.
    const usageSummary =
      subscription.billingMode === 'usage'
        ? await this.usageRating.summarizeForPeriodWithCredits(
            subscription,
            plan,
            { start: subscription.currentPeriodStart, end: anchor },
            await this.credits.availableUnits(subscription.customerId)
          )
        : null;
    const rated: RatedAmount =
      usageSummary ?? this.fixedRating.amountForPeriod(subscription, plan);
    const creditUnitsApplied = usageSummary?.creditUnitsApplied ?? 0;
    const idempotencyKey = `renewal:${subscription.id}:${anchor.getTime()}:${subscription.dunningAttempts}`;

    let charge: ChargeResult;
    if (rated.amountMinor === 0) {
      // Zero-amount renewals (usage with no overage / fully credited, or a fixed
      // $0 plan like Free) aren't chargeable/fiscalizable: skip the provider but
      // still record a zero invoice whose provider_event_id advances the period.
      charge = { providerInvoiceRef: idempotencyKey };
    } else {
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
    }

    await this.handleSuccess(
      subscription,
      customer,
      plan,
      rated,
      creditUnitsApplied,
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
    creditUnitsApplied: number,
    charge: ChargeResult,
    anchor: Date,
    idempotencyKey: string,
    now: Date
  ): Promise<void> {
    const newPeriodStart = anchor;
    const newPeriodEnd = addInterval(anchor, plan.interval);
    // A fixed invoice covers the period being prepaid; a usage invoice covers
    // the metered period that just closed.
    const invoicePeriod =
      subscription.billingMode === 'usage'
        ? { start: subscription.currentPeriodStart, end: anchor }
        : { start: newPeriodStart, end: newPeriodEnd };

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
          amountMinor: Money.fromMinor(rated.amountMinor),
          currency: customer.currency,
          status: 'paid',
          billingMode: subscription.billingMode,
          periodStart: invoicePeriod.start,
          periodEnd: invoicePeriod.end,
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

      // Credits offset this period's billable units; the deduction commits
      // with the winning insert, so a replayed scan spends nothing.
      if (creditUnitsApplied > 0) {
        await this.credits.spendOnUsage(
          manager,
          subscription.customerId,
          rows[0].id,
          creditUnitsApplied
        );
      }

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
