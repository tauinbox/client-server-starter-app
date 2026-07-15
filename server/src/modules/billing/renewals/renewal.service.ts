import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { User } from '../../users/entities/user.entity';
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
 * idempotency layers, not row locks: the per-period `Idempotence-Key` the
 * provider honours, and the unique `provider_event_id` on the renewal `Invoice`
 * (set to that same key) which gates the period advance to exactly once. The
 * key is stable across dunning retries of the same period — a retry after an
 * ambiguous failure (timeout after the provider captured funds) reconciles the
 * prior attempt at the provider instead of charging under a fresh key.
 *
 * A charge the provider accepts but has not captured (`pending`, YooKassa
 * payment-after-receipt) is recorded as a `pending` invoice WITHOUT advancing
 * the period: the confirming webhook or a later scan's poll settles it to
 * `paid` (then the scan advances) or fails it into dunning. Entitlement is
 * subscription-status based, so the deferred advance costs the user nothing.
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
   *
   * Subscriptions of a soft-deleted user are excluded: the user-deleted
   * listener cancels them locally, and the join guards any path that still
   * leaves a live row so a deleted user's saved method is never charged.
   */
  private findDue(now: Date): Promise<Subscription[]> {
    return this.subscriptions
      .createQueryBuilder('s')
      .innerJoin(Customer, 'c', 'c.id = s.customerId')
      .innerJoin(User, 'u', 'u.id = c.userId AND u.deletedAt IS NULL')
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
    // Stable per (subscription, period): a per-attempt key would defeat the
    // provider's dedup and double-charge a retried timeout-after-capture.
    const idempotencyKey = `renewal:${subscription.id}:${anchor.getTime()}`;

    let charge: ChargeResult;
    let settleStored = false;
    if (rated.amountMinor === 0) {
      // Zero-amount renewals (usage with no overage / fully credited, or a fixed
      // $0 plan like Free) aren't chargeable/fiscalizable: skip the provider but
      // still record a zero invoice whose provider_event_id advances the period.
      charge = { providerInvoiceRef: idempotencyKey, status: 'captured' };
    } else {
      const resolved = await this.resolveDueCharge(
        subscription,
        customer,
        plan,
        provider,
        rated,
        creditUnitsApplied,
        anchor,
        idempotencyKey,
        now
      );
      if (!resolved) return;
      charge = resolved.charge;
      settleStored = resolved.settleStored;
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
      now,
      settleStored
    );
  }

  /**
   * Resolves the money side of a due renewal to a captured charge, or `null`
   * when this cycle must not advance the period (charge still pending at the
   * provider, outcome unknown, or a failure that entered dunning). The invoice
   * row under the stable per-period key is the persisted state machine:
   * absent -> charge; pending -> poll the provider; failed -> dun once, then
   * re-charge on the next retry; paid -> nothing left but the advance.
   * `settleStored` marks a charge whose recorded invoice already carries the
   * amount/credit units the provider actually charged - the settle must keep
   * them instead of this scan's re-rated values.
   */
  private async resolveDueCharge(
    subscription: Subscription,
    customer: Customer,
    plan: Plan,
    provider: PaymentProvider,
    rated: RatedAmount,
    creditUnitsApplied: number,
    anchor: Date,
    idempotencyKey: string,
    now: Date
  ): Promise<{ charge: ChargeResult; settleStored: boolean } | null> {
    const existing = await this.dataSource.manager.findOne(Invoice, {
      where: { providerEventId: idempotencyKey }
    });

    if (existing?.status === 'paid' || existing?.status === 'refunded') {
      // The confirming webhook settled the charge; only the advance remains.
      return {
        charge: {
          providerInvoiceRef: existing.providerInvoiceRef,
          status: 'captured'
        },
        settleStored: true
      };
    }

    if (existing?.status === 'pending') {
      let found: ChargeResult | null;
      try {
        found = await provider.findOffSessionCharge(idempotencyKey, anchor);
      } catch (error) {
        this.logger.error(
          `Pending-charge poll failed for subscription ${subscription.id}: ${(error as Error).message}`
        );
        return null;
      }
      if (found?.status === 'captured') {
        return { charge: found, settleStored: true };
      }
      if (found) {
        // Still settling at the provider; the next scan re-checks.
        return null;
      }
      // Canceled at capture. The gated flip runs fail-and-dun exactly once
      // against a concurrent scan or the webhook reducer's own flip.
      const flip = await this.dataSource.manager.update(
        Invoice,
        { providerEventId: idempotencyKey, status: 'pending' },
        { status: 'failed' }
      );
      if (flip.affected) {
        await this.handleFailure(subscription, customer.userId, now);
      }
      return null;
    }

    if (existing?.status === 'failed' && subscription.dunningAttempts === 0) {
      // The webhook recorded the capture-time decline before any scan did:
      // enter dunning without re-charging (the stable key would only replay
      // the declined payment inside the provider's idempotence window).
      await this.handleFailure(subscription, customer.userId, now);
      return null;
    }

    // A prior dunning attempt may have captured funds despite reporting
    // failure (timeout after capture) — reconcile it before charging again.
    let prior: ChargeResult | null = null;
    if (subscription.dunningAttempts > 0) {
      try {
        prior = await provider.findOffSessionCharge(idempotencyKey, anchor);
      } catch (error) {
        // Prior outcome unknown — skip the cycle (dunning state untouched,
        // the next scan retries) rather than risk a duplicate charge.
        this.logger.error(
          `Renewal reconcile failed for subscription ${subscription.id}: ${(error as Error).message}`
        );
        return null;
      }
    }
    if (prior?.status === 'captured') {
      return { charge: prior, settleStored: false };
    }
    if (prior) {
      await this.recordPendingCharge(
        subscription,
        customer,
        plan,
        rated,
        creditUnitsApplied,
        prior.providerInvoiceRef,
        anchor,
        idempotencyKey
      );
      return null;
    }

    let result: ChargeResult;
    try {
      result = await provider.chargeOffSession(
        customer,
        rated.amountMinor,
        rated.receiptItems,
        idempotencyKey
      );
    } catch (error) {
      this.logger.warn(
        `Renewal charge failed for subscription ${subscription.id}: ${(error as Error).message}`
      );
      await this.handleFailure(subscription, customer.userId, now);
      return null;
    }
    if (result.status === 'pending') {
      await this.recordPendingCharge(
        subscription,
        customer,
        plan,
        rated,
        creditUnitsApplied,
        result.providerInvoiceRef,
        anchor,
        idempotencyKey
      );
      return null;
    }
    return { charge: result, settleStored: false };
  }

  /** The moment a subscription is due for its next self-managed charge. */
  private dueAt(subscription: Subscription): Date | null {
    if (subscription.status === 'trialing') return subscription.trialEnd;
    if (subscription.status === 'past_due')
      return subscription.nextRenewalAttemptAt;
    if (subscription.status === 'active') return subscription.currentPeriodEnd;
    return null;
  }

  /**
   * A fixed invoice covers the period being prepaid; a usage invoice covers
   * the metered period that just closed.
   */
  private invoicePeriodFor(
    subscription: Subscription,
    plan: Plan,
    anchor: Date
  ): { start: Date; end: Date } {
    return subscription.billingMode === 'usage'
      ? { start: subscription.currentPeriodStart, end: anchor }
      : { start: anchor, end: addInterval(anchor, plan.interval) };
  }

  /**
   * Records a provider-accepted but not yet captured charge as a `pending`
   * invoice under the stable per-period key, without advancing the period —
   * the confirming webhook or a later scan's poll settles or fails it. The
   * rated amount and the credit units it assumed are persisted so the settle
   * spends exactly what the charge was computed from, immune to balance drift.
   */
  private async recordPendingCharge(
    subscription: Subscription,
    customer: Customer,
    plan: Plan,
    rated: RatedAmount,
    creditUnitsApplied: number,
    providerInvoiceRef: string,
    anchor: Date,
    idempotencyKey: string
  ): Promise<void> {
    const period = this.invoicePeriodFor(subscription, plan, anchor);
    await withTransaction(this.dataSource, async (manager) => {
      const insert = await manager
        .createQueryBuilder()
        .insert()
        .into(Invoice)
        .values({
          customerId: subscription.customerId,
          subscriptionId: subscription.id,
          provider: subscription.provider,
          providerEventId: idempotencyKey,
          providerInvoiceRef,
          amountMinor: Money.fromMinor(rated.amountMinor),
          currency: customer.currency,
          status: 'pending',
          billingMode: subscription.billingMode,
          periodStart: period.start,
          periodEnd: period.end,
          paidAt: null,
          receiptRef: null,
          creditUnitsApplied
        })
        .orIgnore()
        .returning(['id'])
        .execute();
      const rows = insert.raw as Array<{ id: string }>;
      if (rows.length === 0) {
        // A dunning retry reuses the period key: refresh the failed row with
        // the values this new attempt actually charged.
        await manager.update(
          Invoice,
          { providerEventId: idempotencyKey, status: 'failed' },
          {
            status: 'pending',
            providerInvoiceRef,
            amountMinor: Money.fromMinor(rated.amountMinor),
            creditUnitsApplied
          }
        );
      }
    });
    this.logger.log(
      `Renewal charge for subscription ${subscription.id} is pending capture; period advance deferred`
    );
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
    now: Date,
    settleStored: boolean
  ): Promise<void> {
    const newPeriodStart = anchor;
    const newPeriodEnd = addInterval(anchor, plan.interval);
    const invoicePeriod = this.invoicePeriodFor(subscription, plan, anchor);

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
          receiptRef: null,
          creditUnitsApplied
        })
        .orIgnore()
        .returning(['id'])
        .execute();
      const rows = insert.raw as Array<{ id: string }>;

      let paidInvoiceId = rows[0]?.id ?? null;
      let unitsToSpend = paidInvoiceId ? creditUnitsApplied : 0;
      if (!paidInvoiceId) {
        // The stable per-period key already has a row: settle it while still
        // uncaptured. A settle of a recorded pending charge keeps the stored
        // amount/credit units (what the provider actually charged); a fresh
        // retry charge overwrites a failed row with its own values.
        const existing = await manager.findOne(Invoice, {
          where: { providerEventId: idempotencyKey }
        });
        if (
          existing &&
          (existing.status === 'pending' || existing.status === 'failed')
        ) {
          const flip = await manager.update(
            Invoice,
            { id: existing.id, status: existing.status },
            {
              status: 'paid',
              paidAt: now,
              providerInvoiceRef: charge.providerInvoiceRef,
              ...(settleStored
                ? {}
                : {
                    amountMinor: Money.fromMinor(rated.amountMinor),
                    creditUnitsApplied
                  })
            }
          );
          if (flip.affected) {
            paidInvoiceId = existing.id;
            unitsToSpend = settleStored
              ? existing.creditUnitsApplied
              : creditUnitsApplied;
          }
        }
      }

      // Credits commit with the winning insert/flip, so a replayed scan (or
      // the webhook reducer's own settle) spends nothing a second time.
      if (paidInvoiceId && unitsToSpend > 0) {
        await this.credits.spendOnUsage(
          manager,
          subscription.customerId,
          paidInvoiceId,
          unitsToSpend
        );
      }

      // CAS on the period end read at scan start: the advance (and its event)
      // runs exactly once even against a concurrent scan.
      const advance = await manager.update(
        Subscription,
        {
          id: subscription.id,
          currentPeriodEnd: subscription.currentPeriodEnd
        },
        {
          status: 'active',
          currentPeriodStart: newPeriodStart,
          currentPeriodEnd: newPeriodEnd,
          trialEnd: null,
          dunningAttempts: 0,
          nextRenewalAttemptAt: null
        }
      );

      return { paidInvoiceId, advanced: advance.affected === 1 };
    });

    if (result.paidInvoiceId) {
      this.events.emit(
        InvoicePaidEvent.name,
        new InvoicePaidEvent(customer.userId, result.paidInvoiceId)
      );
    }
    if (result.advanced) {
      this.events.emit(
        SubscriptionRenewedEvent.name,
        new SubscriptionRenewedEvent(customer.userId, subscription.id)
      );
    }
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
