import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  Repository,
  type QueryDeepPartialEntity
} from 'typeorm';
import type { SubscriptionStatus } from '@app/shared/types';
import { Money } from '@app/shared/utils/money';
import { renewalAnchor } from '@app/shared/utils/billing-rules';
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@app/shared/constants';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { User } from '../../users/entities/user.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice, UNPAID_INVOICE_STATUSES } from '../entities/invoice.entity';
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
import { RENEWAL_CHARGE_KEY_PREFIX } from '../utils/charge-keys.util';
import { insertInvoiceOnce } from '../utils/invoice-insert.util';
import { nextPeriodEnd } from '../utils/period.util';
import {
  DUNNING_MAX_ATTEMPTS,
  DUNNING_RETRY_DELAY_MS,
  PLAN_CHANGE_LEASE_MS,
  RENEWAL_SCAN_MAX_PER_RUN
} from './renewal-queue.constants';

/**
 * The subscription being charged, one period of it, and the stable key that
 * every invoice write for that period shares.
 */
interface PeriodCharge {
  subscription: Subscription;
  customer: Customer;
  plan: Plan;
  provider: PaymentProvider;
  period: { start: Date; end: Date };
  idempotencyKey: string;
}

/** A period rated and recorded as an unpaid invoice before it is charged. */
interface DueCharge extends PeriodCharge {
  rated: RatedAmount;
}

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
    private readonly events: EventEmitter2
  ) {}

  /** Processes every due self-managed subscription; one failure never aborts the rest. */
  async runDueRenewals(now: Date = new Date()): Promise<void> {
    const due = await this.findDue(now);

    if (due.length === RENEWAL_SCAN_MAX_PER_RUN) {
      this.logger.warn(
        `Renewal scan hit its per-run ceiling (${RENEWAL_SCAN_MAX_PER_RUN} subscriptions); any remaining due subscriptions are left for the next scan`
      );
    }

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
   * one reaching its next dunning retry. A renewal prepays the next period.
   *
   * Subscriptions of a soft-deleted user are excluded: the user-deleted
   * listener cancels them locally, and the join guards any path that still
   * leaves a live row so a deleted user's saved method is never charged.
   *
   * A row with a live plan change lease is excluded too: the change prices
   * and charges the period this scan would renew, so a later scan renews it
   * under the plan the change leaves.
   *
   * Capped at `RENEWAL_SCAN_MAX_PER_RUN` and served oldest-due-first, so a
   * backlog drains in due order across successive scans: `processSubscription`
   * re-reads the row and re-checks the due moment, the provider charge is keyed
   * per period, and the period advance is a CAS - deferring a subscription to a
   * later scan is safe by construction.
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
      .andWhere(
        '(s.planChangeStartedAt IS NULL OR s.planChangeStartedAt <= :leaseExpiry)'
      )
      .setParameters({
        now,
        leaseExpiry: new Date(now.getTime() - PLAN_CHANGE_LEASE_MS),
        trialing: 'trialing',
        active: 'active',
        pastDue: 'past_due'
      })
      .orderBy('s.currentPeriodEnd', 'ASC')
      .limit(RENEWAL_SCAN_MAX_PER_RUN)
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

    if (
      subscription.planChangeStartedAt &&
      subscription.planChangeStartedAt.getTime() >
        now.getTime() - PLAN_CHANGE_LEASE_MS
    ) {
      // A plan change claimed the row after the due list was read.
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

    // Cancel-at-period-end: stop at the boundary instead of opening another
    // period. The period that is closing was prepaid, so nothing is left to
    // bill.
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
    const anchor = renewalAnchor(subscription);
    const due: PeriodCharge = {
      subscription,
      customer,
      plan,
      provider,
      period: {
        start: anchor,
        end: nextPeriodEnd(
          this.billingAnchor(subscription, anchor),
          anchor,
          plan.interval
        )
      },
      // Stable per (subscription, period): a per-attempt key would defeat the
      // provider's dedup and double-charge a retried timeout-after-capture.
      idempotencyKey: `${RENEWAL_CHARGE_KEY_PREFIX}${subscription.id}:${anchor.getTime()}`
    };

    // Resolved even when the period rates to zero: the invoice recorded under
    // the stable key is inspected before any decision, so a re-rate that drops
    // to zero can never settle a charge an earlier scan left open.
    const charge = await this.resolveDueCharge(due, anchor, now);

    if (!charge) {
      return;
    }

    await this.handleSuccess(due, charge, { anchor, now });
  }

  /**
   * Resolves the money side of a due renewal to a captured charge, or `null`
   * when this cycle must not advance the period (charge still pending at the
   * provider, outcome unknown, or a failure that entered dunning). The invoice
   * row under the stable per-period key is the persisted state machine:
   * absent -> record, then charge; pending -> poll the provider; failed -> dun
   * once, then re-rate and re-charge on the next retry; paid -> nothing left
   * but the advance. The row always holds the amount the provider was asked
   * for, and the settle keeps it.
   *
   * A period that rates to zero is resolved here too, and only after that
   * inspection: deciding "nothing to charge" up front would settle an invoice
   * recorded for a charge still open at the provider and overwrite the real
   * payment reference with the idempotency key.
   */
  private async resolveDueCharge(
    due: PeriodCharge,
    anchor: Date,
    now: Date
  ): Promise<ChargeResult | null> {
    const { subscription, customer, provider, idempotencyKey } = due;
    const existing = await this.dataSource.manager.findOne(Invoice, {
      where: { providerEventId: idempotencyKey }
    });

    if (existing?.status === 'paid' || existing?.status === 'refunded') {
      // The confirming webhook settled the charge; only the advance remains.
      return {
        providerInvoiceRef: existing.providerInvoiceRef,
        status: 'captured'
      };
    }

    if (existing?.status === 'pending') {
      if (existing.amountMinor.toNumber() === 0) {
        // Recorded by a scan that stopped before its settle; a zero amount
        // never reaches the provider.
        return { providerInvoiceRef: idempotencyKey, status: 'captured' };
      }

      let found: ChargeResult | null;

      try {
        // Every writer of a pending row records the provider's payment
        // reference, so the poll reads that one payment instead of walking the
        // shop's list; the scan stays as the fallback for a row without one.
        found = existing.providerInvoiceRef
          ? await provider.getOffSessionCharge(
              existing.providerInvoiceRef,
              idempotencyKey
            )
          : await provider.findOffSessionCharge(idempotencyKey, anchor);
      } catch (error) {
        this.logger.error(
          `Pending-charge poll failed for subscription ${subscription.id}: ${(error as Error).message}`
        );

        return null;
      }

      if (found?.status === 'captured') {
        return found;
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
    // An attempt is recorded before it is charged, so with no row there is
    // no prior attempt.
    let prior: ChargeResult | null = null;

    if (existing && subscription.dunningAttempts > 0) {
      try {
        prior = existing.providerInvoiceRef
          ? await provider.getOffSessionCharge(
              existing.providerInvoiceRef,
              idempotencyKey
            )
          : await provider.findOffSessionCharge(idempotencyKey, anchor);
      } catch (error) {
        // Prior outcome unknown — skip the cycle (dunning state untouched,
        // the next scan retries) rather than risk a duplicate charge.
        this.logger.error(
          `Renewal reconcile failed for subscription ${subscription.id}: ${(error as Error).message}`
        );

        return null;
      }
    }

    // A prior attempt's charge carries the amount that attempt was rated at,
    // which the recorded row already holds.
    if (prior?.status === 'captured') {
      return prior;
    }

    if (prior) {
      await this.recordPendingCharge(due, prior.providerInvoiceRef, 'failed');

      return null;
    }

    const planted = await this.plantCharge(due);

    if (!planted) {
      // Another scan recorded this period first and is charging it.
      return null;
    }

    const { rated } = planted;

    if (rated.amountMinor === 0) {
      // A zero-amount renewal (a fixed $0 plan like Free) is not chargeable or
      // fiscalizable: skip the provider and settle the recorded zero invoice,
      // whose key advances the period.
      // Reached only once no charge is open at the provider under this key.
      return { providerInvoiceRef: idempotencyKey, status: 'captured' };
    }

    let result: ChargeResult;

    try {
      result = await provider.chargeOffSession(customer, {
        amountMinor: rated.amountMinor,
        currency: rated.currency,
        receiptItems: rated.receiptItems,
        idempotencyKey
      });
    } catch (error) {
      this.logger.warn(
        `Renewal charge failed for subscription ${subscription.id}: ${(error as Error).message}`
      );
      await this.recordUnpaidCharge(planted);
      await this.handleFailure(subscription, customer.userId, now);

      return null;
    }

    if (result.status === 'pending') {
      await this.recordPendingCharge(due, result.providerInvoiceRef, 'pending');

      return null;
    }

    return result;
  }

  /**
   * Rates the period and records it as a `pending` invoice under its stable
   * key BEFORE the provider is asked for the money, so the confirming webhook
   * always finds a row. A `failed` row of an earlier attempt is re-rated in
   * place. Returns `null` when the key is already taken by a row this call
   * must not overwrite.
   */
  private plantCharge(due: PeriodCharge): Promise<DueCharge | null> {
    const { subscription, plan, idempotencyKey } = due;

    return withTransaction(this.dataSource, async (manager) => {
      const existing = await manager.findOne(Invoice, {
        where: { providerEventId: idempotencyKey }
      });

      if (existing && existing.status !== 'failed') {
        return null;
      }

      const planted: DueCharge = {
        ...due,
        rated: this.fixedRating.amountForPeriod(subscription, plan)
      };
      const providerInvoiceRef =
        planted.rated.amountMinor === 0 ? idempotencyKey : '';

      if (!existing) {
        const invoiceId = await insertInvoiceOnce(manager, {
          ...this.invoiceValues(planted),
          providerInvoiceRef,
          status: 'pending',
          paidAt: null
        });

        return invoiceId ? planted : null;
      }

      const flip = await manager.update(
        Invoice,
        { id: existing.id, status: 'failed' },
        {
          status: 'pending',
          providerInvoiceRef,
          amountMinor: Money.fromMinor(planted.rated.amountMinor)
        }
      );

      return flip.affected ? planted : null;
    });
  }

  /** The moment a subscription is due for its next self-managed charge. */
  private dueAt(subscription: Subscription): Date | null {
    if (subscription.status === 'trialing') return subscription.trialEnd;

    if (subscription.status === 'past_due')
      return subscription.nextRenewalAttemptAt;

    if (subscription.status === 'active') return subscription.currentPeriodEnd;

    return null;
  }

  /** The invoice columns that do not depend on the charge outcome. */
  private invoiceValues(due: DueCharge): QueryDeepPartialEntity<Invoice> {
    const { subscription, rated, period } = due;

    return {
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      provider: subscription.provider,
      providerEventId: due.idempotencyKey,
      amountMinor: Money.fromMinor(rated.amountMinor),
      currency: rated.currency,
      billingMode: subscription.billingMode,
      periodStart: period.start,
      periodEnd: period.end,
      receiptRef: null
    };
  }

  /**
   * The day billing is anchored on, which every boundary is restored to. A trial
   * converts at `trial_end`, so the first paid period re-anchors there rather
   * than on the checkout moment. A row written before the column existed falls
   * back to its current period start.
   */
  private billingAnchor(subscription: Subscription, anchor: Date): Date {
    return subscription.status === 'trialing' && subscription.trialEnd
      ? anchor
      : (subscription.billingAnchorAt ?? subscription.currentPeriodStart);
  }

  /**
   * Marks the recorded row as a provider-accepted but not yet captured charge
   * and attaches the payment reference, without advancing the period - the
   * confirming webhook or a later scan's poll settles or fails it. `from` is
   * the status the row holds: `pending` for the charge this scan recorded,
   * `failed` for the open charge of an earlier attempt. The row keeps the
   * amount it was recorded with.
   */
  private async recordPendingCharge(
    due: PeriodCharge,
    providerInvoiceRef: string,
    from: 'pending' | 'failed'
  ): Promise<void> {
    await this.dataSource.manager.update(
      Invoice,
      { providerEventId: due.idempotencyKey, status: from },
      { status: 'pending', providerInvoiceRef }
    );
    this.logger.log(
      `Renewal charge for subscription ${due.subscription.id} is pending capture; period advance deferred`
    );
  }

  /**
   * Books a renewal period whose charge could not be collected. A throw does
   * not mean no payment: the deadline rejects our call without cancelling the
   * socket, so the confirming webhook can still settle the row.
   */
  private async recordUnpaidCharge(due: DueCharge): Promise<void> {
    const { subscription, idempotencyKey } = due;

    await this.dataSource.manager.update(
      Invoice,
      { providerEventId: idempotencyKey, status: 'pending' },
      { status: 'failed' }
    );
    this.logger.warn(
      `Renewal period of subscription ${subscription.id} recorded unpaid (${idempotencyKey}); entering dunning`
    );
  }

  private async handleSuccess(
    due: PeriodCharge,
    charge: ChargeResult,
    { anchor, now }: { anchor: Date; now: Date }
  ): Promise<void> {
    const { subscription, customer, plan, idempotencyKey } = due;
    const billingAnchor = this.billingAnchor(subscription, anchor);

    const result = await withTransaction(this.dataSource, async (manager) => {
      const paidInvoiceId = await this.settlePeriodInvoice(manager, due, {
        providerInvoiceRef: charge.providerInvoiceRef,
        now
      });

      // CAS on the period end and status read at scan start: a cancel landing
      // during the provider round-trip leaves `currentPeriodEnd` untouched and
      // must not be flipped back to `active`. `cancelAtPeriodEnd` is absent on
      // purpose — the period just paid for opens, the flag stops the next one.
      const transition = await manager.update(
        Subscription,
        {
          id: subscription.id,
          currentPeriodEnd: subscription.currentPeriodEnd,
          status: In([...ENTITLED_SUBSCRIPTION_STATUSES])
        },
        {
          status: 'active',
          currentPeriodStart: anchor,
          currentPeriodEnd: nextPeriodEnd(billingAnchor, anchor, plan.interval),
          billingAnchorAt: billingAnchor,
          trialEnd: null,
          dunningAttempts: 0,
          nextRenewalAttemptAt: null
        }
      );

      // A concurrent scan winning the CAS is expected and silent; a charge
      // against a no-longer-chargeable row needs an operator.
      let blockedBy: SubscriptionStatus | null = null;

      if (transition.affected !== 1) {
        const current = await manager.findOne(Subscription, {
          where: { id: subscription.id }
        });

        if (
          current &&
          !ENTITLED_SUBSCRIPTION_STATUSES.includes(current.status)
        ) {
          blockedBy = current.status;
        }
      }

      return {
        paidInvoiceId,
        applied: transition.affected === 1,
        blockedBy
      };
    });

    if (result.blockedBy) {
      this.logger.warn(
        `Renewal charge for subscription ${subscription.id} captured after it became ${result.blockedBy}; period not advanced, invoice ${result.paidInvoiceId ?? idempotencyKey} left recorded and refundable`
      );
    }

    if (result.paidInvoiceId) {
      this.events.emit(
        InvoicePaidEvent.name,
        new InvoicePaidEvent(customer.userId, result.paidInvoiceId)
      );
    }

    if (result.applied) {
      this.events.emit(
        SubscriptionRenewedEvent.name,
        new SubscriptionRenewedEvent(customer.userId, subscription.id)
      );
    }
  }

  /**
   * Settles the period's recorded invoice to `paid`, inside the caller's
   * transaction so the money and the subscription transition land together.
   * The flip is guarded on an unpaid status, so a replayed scan (or the
   * webhook reducer's own settle) loses it. Returns the invoice id only to the
   * winner.
   */
  private async settlePeriodInvoice(
    manager: EntityManager,
    due: PeriodCharge,
    { providerInvoiceRef, now }: { providerInvoiceRef: string; now: Date }
  ): Promise<string | null> {
    const { idempotencyKey } = due;
    const flip = await manager.update(
      Invoice,
      {
        providerEventId: idempotencyKey,
        status: In([...UNPAID_INVOICE_STATUSES])
      },
      { status: 'paid', paidAt: now, providerInvoiceRef }
    );

    if (!flip.affected) {
      return null;
    }

    const invoice = await manager.findOne(Invoice, {
      where: { providerEventId: idempotencyKey }
    });

    return invoice?.id ?? null;
  }

  private async handleFailure(
    subscription: Subscription,
    userId: string,
    now: Date
  ): Promise<void> {
    const attempts = subscription.dunningAttempts + 1;
    const exhausted = attempts >= DUNNING_MAX_ATTEMPTS;

    // CAS on the rung this scan claimed at its start, never on a re-read one:
    // two scans racing one decline charge under the same idempotency key, so
    // a re-read would let the second consume a second rung of a three-rung
    // ladder, cancelling a paying customer early and notifying them twice.
    const applied = await this.dataSource.manager.update(
      Subscription,
      {
        id: subscription.id,
        dunningAttempts: subscription.dunningAttempts,
        status: In([...ENTITLED_SUBSCRIPTION_STATUSES])
      },
      exhausted
        ? {
            dunningAttempts: attempts,
            status: 'canceled',
            cancelAtPeriodEnd: false,
            nextRenewalAttemptAt: null
          }
        : {
            dunningAttempts: attempts,
            status: 'past_due',
            nextRenewalAttemptAt: new Date(
              now.getTime() + DUNNING_RETRY_DELAY_MS
            )
          }
    );

    if (applied.affected !== 1) return;

    this.events.emit(
      PaymentFailedEvent.name,
      new PaymentFailedEvent(userId, subscription.id)
    );

    if (exhausted) {
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

  /**
   * Guarded on the state that justified the cancel: saving the whole entity
   * loaded at scan start would re-cancel an already-canceled row, emit a second
   * event, and write back columns another writer moved in between, including
   * the version token the self-service plan change swaps on.
   */
  private async cancelAtPeriodEnd(
    subscription: Subscription,
    userId: string
  ): Promise<void> {
    const applied = await this.dataSource.manager.update(
      Subscription,
      {
        id: subscription.id,
        status: In([...ENTITLED_SUBSCRIPTION_STATUSES]),
        cancelAtPeriodEnd: true
      },
      { status: 'canceled', nextRenewalAttemptAt: null }
    );

    if (applied.affected !== 1) return;

    this.events.emit(
      SubscriptionCanceledEvent.name,
      new SubscriptionCanceledEvent(userId, subscription.id)
    );
  }
}
