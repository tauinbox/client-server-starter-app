import { Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../../common/errors/api-error';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  EntityManager,
  FindOneOptions,
  In,
  IsNull,
  LessThanOrEqual,
  Like,
  Not,
  Or,
  Repository
} from 'typeorm';
import { Money } from '@app/shared/utils/money';
import {
  meteredWindowStart,
  renewalAnchor
} from '@app/shared/utils/billing-rules';
import {
  CHANGEABLE_SUBSCRIPTION_STATUSES,
  ErrorKeys
} from '@app/shared/constants';
import type { PlanPrice, ProrationPreviewResponse } from '@app/shared/types';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { Customer } from '../entities/customer.entity';
import { Invoice, UNPAID_INVOICE_STATUSES } from '../entities/invoice.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  PlanChangedEvent,
  UsagePeriodClosedEvent
} from '../events/billing.events';
import { ChargeDeclinedError } from '../providers/payment-provider.interface';
import type {
  ChargeResult,
  PaymentProvider
} from '../providers/payment-provider.interface';
import {
  ProrationCalculator,
  type ProrationQuote
} from '../rating/proration-calculator';
import {
  currentPlanMissing,
  planNotFound,
  subscriptionNotLinked
} from '../utils/billing-errors.util';
import {
  changeChargeKey,
  changeChargeKeyPrefix,
  changeRefundKey
} from '../utils/charge-keys.util';
import { insertInvoiceOnce } from '../utils/invoice-insert.util';
import { requireOpenSubscription } from '../utils/open-subscription.util';
import {
  lockInvoice,
  releaseRefund,
  remainingRefundable,
  reserveRefund
} from '../utils/refund-reservation.util';
import { PLAN_CHANGE_LEASE_MS } from '../renewals/renewal-queue.constants';
import { RenewalService } from '../renewals/renewal.service';
import { BillingService } from '../billing.service';

/** Everything a plan change / proration preview operates on. */
interface ChangeContext {
  customer: Customer;
  subscription: Subscription;
  fromPlan: Plan;
  toPlan: Plan;
  /** The price of `toPlan` for the provider of the subscription. */
  toPrice: PlanPrice;
  provider: PaymentProvider;
}

/** A switch from a usage plan to a fixed one ends the metered window. */
function closesMeteredWindow(
  subscription: Subscription,
  toPlan: Plan
): boolean {
  return subscription.billingMode === 'usage' && toPlan.billingMode !== 'usage';
}

/**
 * The caller's instant plan change and its proration preview. Like the rest of
 * the self-service, every call is keyed on the caller's `userId`.
 */
@Injectable()
export class PlanChangeService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly billing: BillingService,
    private readonly renewals: RenewalService,
    private readonly proration: ProrationCalculator,
    private readonly events: EventEmitter2
  ) {}

  private readonly logger = new Logger(PlanChangeService.name);

  /**
   * Instant plan/mode change with proration. Paddle
   * delegates the money side (`subscriptions.update`, prorated immediately) and
   * the local row is updated optimistically - the provider's webhooks confirm.
   * YooKassa is computed here: charge the new plan's prorated remainder first
   * (the failure-prone leg - a declined card aborts the switch with nothing
   * moved), then refund the old plan's unused remainder; each leg is its own
   * fiscal document and its own local invoice row. A refund failure after a
   * successful charge is logged and the switch proceeds - the admin console can
   * re-issue the refund, while reverting would double-tangle the money.
   *
   * A switch of billing mode starts a new metered window at the switch, on both
   * providers. A switch from a usage plan bills the units of the closing window
   * under the outgoing plan; a switch to one never rates the units consumed on
   * the fixed plan before it.
   */
  async changePlan(userId: string, planKey: string): Promise<Subscription> {
    const ctx = await this.resolveChangeContext(userId, planKey);
    const { customer, subscription, fromPlan, toPlan, provider } = ctx;
    const now = new Date();

    if (provider.managesLifecycle) {
      const providerSubscriptionId = subscription.providerSubscriptionId;
      if (!providerSubscriptionId) {
        throw subscriptionNotLinked();
      }
      // Serialize against a concurrent change on the same row before delegating.
      return this.whileClaimed(subscription, async () => {
        await provider.changePlan(providerSubscriptionId, customer, toPlan);
        return this.applyPlanChange(ctx, now);
      });
    }

    // Trial: nothing has been charged yet, so a switch moves no fixed money.
    const quote =
      subscription.status === 'trialing'
        ? null
        : this.proration.quote({
            fromPlan,
            toPlan,
            provider: provider.id,
            periodStart: subscription.currentPeriodStart,
            periodEnd: subscription.currentPeriodEnd,
            now
          });

    // Claim the change before any money moves: a concurrent change or a
    // renewal scan is kept off the row until it is released, so the provider
    // is never asked for a second, conflicting charge.
    return this.whileClaimed(subscription, () =>
      this.applySelfManagedChange(ctx, quote, now)
    );
  }

  /**
   * The money legs and the commit of a self-managed switch, run under the
   * claim of the row.
   */
  private async applySelfManagedChange(
    ctx: ChangeContext,
    quote: ProrationQuote | null,
    now: Date
  ): Promise<Subscription> {
    const { customer, subscription, fromPlan, toPlan, provider } = ctx;
    const seq = subscription.planChangeSeq;
    const chargeKey = changeChargeKey(subscription.id, seq, toPlan.key);
    const refundKey = changeRefundKey(subscription.id, seq);
    await this.assertNoUnfinishedSwitch(subscription, seq, chargeKey);

    // External legs run outside the DB transaction - a provider HTTP call must
    // never be held inside an open transaction. Both keys are stable across
    // retries so a replay reconciles instead of charging/refunding twice.
    let chargeInvoiceId: string | null = null;
    let chargeRef: string | null = null;
    let chargeCaptured = true;
    if (quote && quote.chargeMinor > 0) {
      const planted = await this.plantChangeCharge({
        subscription,
        providerEventId: chargeKey,
        amountMinor: quote.chargeMinor,
        currency: quote.currency,
        billingMode: toPlan.billingMode
      });
      chargeInvoiceId = planted.id;
      if (planted.paidRef !== null) {
        // A retry after the webhook settled the charge of the earlier attempt.
        chargeRef = planted.paidRef;
      } else {
        let charge: ChargeResult;
        try {
          charge = await provider.chargeOffSession(
            customer,
            quote.chargeMinor,
            quote.currency,
            quote.chargeItems,
            chargeKey
          );
        } catch (error) {
          await this.failPlantedCharge(chargeKey, error);
          throw error;
        }
        chargeRef = charge.providerInvoiceRef;
        // Uncaptured (payment-after-receipt) stays pending for the webhook.
        chargeCaptured = charge.status === 'captured';
        await this.recordChargeRef(chargeKey, chargeRef);
      }
    }

    // The fixed plan must not absorb units metered before the switch: they are
    // billed now under the outgoing plan. The window moves in its own write, so
    // a guard miss below cannot leave the billed units for the renewal to bill
    // again.
    if (closesMeteredWindow(subscription, toPlan)) {
      await this.renewals.billClosingUsagePeriod(subscription, now);
      await this.subscriptions.update(
        { id: subscription.id },
        { meteredFrom: now }
      );
    }

    // Reserved after the charge, since a charge failure aborts the switch and
    // would strand the reservation; the charge leg is excluded by id.
    const refund =
      quote && quote.refundMinor > 0
        ? await this.reserveProrationRefund(
            subscription,
            quote.refundMinor,
            refundKey,
            chargeInvoiceId
          )
        : null;

    let refundIssued = false;
    if (refund) {
      try {
        await provider.refund(
          refund.source.providerInvoiceRef,
          refund.minor,
          refundKey
        );
        refundIssued = true;
      } catch (error) {
        await this.releaseProrationRefund(
          refund.source.id,
          refund.minor,
          refundKey
        );
        // A refund failure after a successful charge never reverts the switch -
        // reverting would double-tangle the money; the admin console can re-issue.
        this.logger.error(
          `Proration refund failed for subscription ${subscription.id} (${refund.minor} minor): ${(error as Error).message}`
        );
      }
    }

    // One transaction so a crash can't leave the plan applied without the money.
    // A guarded apply that loses to a concurrent writer still commits the legs:
    // the money already left, and the paid webhook only settles an invoice this
    // path planted - it never inserts one, so nothing else would record it.
    const { saved, chargeSettled } = await withTransaction(
      this.dataSource,
      async (manager) => {
        const chargeSettled =
          chargeRef && chargeCaptured
            ? await this.settleChangeCharge(manager, chargeKey, chargeRef)
            : false;
        if (refundIssued && refund) {
          await manager.update(
            Invoice,
            { providerEventId: refundKey, status: 'pending' },
            { status: 'refunded', paidAt: new Date() }
          );
          // Gated on this leg's own cumulative, as the admin refund is, so a
          // concurrent leg still in flight cannot flip it for money that may
          // never move. A subscription invoice has no grant or credit to revoke.
          if (refund.cumulative.compare(refund.source.amountMinor) >= 0) {
            await manager.update(
              Invoice,
              { id: refund.source.id, status: 'paid' },
              { status: 'refunded' }
            );
          }
        }
        const saved = await this.commitPlanChange(
          manager,
          subscription,
          toPlan,
          now
        );
        return { saved, chargeSettled };
      }
    );

    if (saved) {
      this.events.emit(
        PlanChangedEvent.name,
        new PlanChangedEvent(
          customer.userId,
          saved.id,
          fromPlan.key,
          toPlan.key
        )
      );
    }
    // The webhook runs the same guarded flip, so gating on the win is what
    // keeps exactly one side announcing the payment.
    if (chargeInvoiceId && chargeSettled) {
      this.events.emit(
        InvoicePaidEvent.name,
        new InvoicePaidEvent(customer.userId, chargeInvoiceId)
      );
    }
    if (!saved) {
      throw new ApiError(
        ErrorKeys.BILLING.PLAN_CHANGE_PAYMENT_CONFLICT,
        'This subscription changed while the payment was in flight; the plan was not switched. Any amount charged is on your invoices.'
      );
    }
    return saved;
  }

  /**
   * Refuses a switch while a switch of the same `seq` to another plan has a
   * charge that may hold money. A retry to another target would charge again,
   * and its refund would take the newest paid invoice, which is that charge, so
   * the money of the first target would stay with the merchant. A `failed` row
   * is a decline and holds no money.
   */
  private async assertNoUnfinishedSwitch(
    subscription: Subscription,
    seq: number,
    chargeKey: string
  ): Promise<void> {
    // A uuid and an integer: the prefix holds no LIKE wildcard to escape.
    const prefix = changeChargeKeyPrefix(subscription.id, seq);
    const unfinished = await this.invoices.findOne({
      where: {
        subscriptionId: subscription.id,
        providerEventId: And(Like(`${prefix}%`), Not(chargeKey)),
        status: In(['pending', 'paid'])
      }
    });
    if (!unfinished?.providerEventId) return;
    const planKey = unfinished.providerEventId.slice(prefix.length);
    throw new ApiError(
      ErrorKeys.BILLING.PLAN_CHANGE_UNFINISHED,
      `A switch to plan "${planKey}" was charged but did not finish. Switch to that plan again to finish it.`
    );
  }

  /**
   * Runs `change` under the claim of the row and releases the claim however
   * the change ends, so the renewal scan does not wait for the lease to expire.
   */
  private async whileClaimed<T>(
    subscription: Subscription,
    change: () => Promise<T>
  ): Promise<T> {
    const lease = await this.claimChange(subscription);
    try {
      return await change();
    } finally {
      await this.releaseChange(subscription.id, lease);
    }
  }

  /**
   * Writes the columns the change owns, and only while the row still looks
   * like the one the change was claimed against. The entity was loaded before
   * the provider round-trip, so committing it whole would write back every
   * column as it looked then - reverting whatever landed during that window (a
   * cancellation, a dunning write, a period advance, or a mode switch that the
   * provider's webhook already applied and closed the window for). A switch of
   * billing mode also starts a new metered window at `now`. A self-managed
   * period that a renewal advanced past an expired lease is not the one the
   * switch priced. Returns the re-read row, or `null` when the guard missed
   * and the caller must refuse the switch.
   */
  private async commitPlanChange(
    manager: EntityManager,
    subscription: Subscription,
    toPlan: Plan,
    now: Date
  ): Promise<Subscription | null> {
    const modeChanges = toPlan.billingMode !== subscription.billingMode;
    const applied = await manager.update(
      Subscription,
      {
        id: subscription.id,
        version: subscription.version,
        billingMode: subscription.billingMode,
        status: In([...CHANGEABLE_SUBSCRIPTION_STATUSES]),
        cancelAtPeriodEnd: false,
        ...(subscription.lifecycleOwner === 'self'
          ? { currentPeriodEnd: subscription.currentPeriodEnd }
          : {})
      },
      {
        planKey: toPlan.key,
        billingMode: toPlan.billingMode,
        planChangeSeq: () => 'plan_change_seq + 1',
        ...(modeChanges ? { meteredFrom: now } : {})
      }
    );
    if (applied.affected !== 1) return null;

    subscription.planKey = toPlan.key;
    subscription.billingMode = toPlan.billingMode;
    if (modeChanges) {
      subscription.meteredFrom = now;
    }
    const fresh = await manager.findOne(Subscription, {
      where: { id: subscription.id }
    });
    return fresh ?? subscription;
  }

  /**
   * Compare-and-swap claim on the subscription's version and its change lease:
   * the first change to land bumps the version and takes the lease. A change
   * that read the same version, or that starts while the lease is live, loses
   * the CAS and is rejected before any money moves, and the renewal scan skips
   * a row with a live lease. Stays out of the DB transaction so no row lock is
   * held across the provider HTTP call. Returns the lease.
   */
  private async claimChange(subscription: Subscription): Promise<Date> {
    const claimedAt = new Date();
    // The entry guard ran before the catalog reads. A renewal scan that started
    // since then is charging this period, and the lease cannot stop it.
    this.assertBeforeRenewal(subscription, claimedAt);
    const result = await this.subscriptions.update(
      {
        id: subscription.id,
        version: subscription.version,
        status: In([...CHANGEABLE_SUBSCRIPTION_STATUSES]),
        cancelAtPeriodEnd: false,
        planChangeStartedAt: Or(
          IsNull(),
          LessThanOrEqual(new Date(claimedAt.getTime() - PLAN_CHANGE_LEASE_MS))
        )
      },
      { version: subscription.version + 1, planChangeStartedAt: claimedAt }
    );
    if (result.affected !== 1) {
      throw new ApiError(
        ErrorKeys.BILLING.SUBSCRIPTION_BUSY,
        'This subscription is already being updated. Please retry.'
      );
    }
    subscription.version += 1;
    return claimedAt;
  }

  /** Releases the lease; a lease that stays set expires on its own. */
  private async releaseChange(id: string, lease: Date): Promise<void> {
    try {
      await this.subscriptions.update(
        { id, planChangeStartedAt: lease },
        { planChangeStartedAt: null }
      );
    } catch (error) {
      this.logger.error(
        `Plan change lease of subscription ${id} was not released: ${(error as Error).message}`
      );
    }
  }

  /**
   * A self-managed period past its due moment belongs to the renewal scan: a
   * switch now races that charge, or bills usage for time the next fixed
   * period also prepays.
   */
  private assertBeforeRenewal(subscription: Subscription, at: Date): void {
    if (
      subscription.lifecycleOwner === 'self' &&
      renewalAnchor(subscription).getTime() <= at.getTime()
    ) {
      throw new ApiError(
        ErrorKeys.BILLING.RENEWAL_IN_PROGRESS,
        'The billing period has ended and its renewal is in progress. Try again shortly.'
      );
    }
  }

  /**
   * What an instant switch to `planKey` would cost right now, without applying
   * it. Paddle answers via `previewUpdate` (net only); YooKassa is the local
   * calculator's split, with the credit capped as the executed refund caps it.
   */
  async previewChange(
    userId: string,
    planKey: string
  ): Promise<ProrationPreviewResponse> {
    const ctx = await this.resolveChangeContext(userId, planKey);
    const { subscription, fromPlan, toPlan, provider } = ctx;
    const base = {
      provider: provider.id,
      fromPlanKey: fromPlan.key,
      toPlanKey: toPlan.key
    };

    if (provider.managesLifecycle) {
      if (!subscription.providerSubscriptionId) {
        throw subscriptionNotLinked();
      }
      const preview = await provider.previewChangePlan(
        subscription.providerSubscriptionId,
        toPlan
      );
      return {
        ...base,
        currency: preview.currency,
        creditMinor: null,
        chargeMinor: null,
        dueNowMinor: preview.amountMinor
      };
    }

    if (subscription.status === 'trialing') {
      return {
        ...base,
        currency: ctx.toPrice.currency,
        creditMinor: 0,
        chargeMinor: 0,
        dueNowMinor: 0
      };
    }

    const seq = subscription.planChangeSeq;
    const chargeKey = changeChargeKey(subscription.id, seq, toPlan.key);
    await this.assertNoUnfinishedSwitch(subscription, seq, chargeKey);
    const quote = this.proration.quote({
      fromPlan,
      toPlan,
      provider: provider.id,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      now: new Date()
    });
    // A retry of a switch that did not commit reuses the rows of the earlier
    // attempt, so the preview reads them too.
    const charge =
      quote.chargeMinor > 0
        ? await this.invoices.findOne({ where: { providerEventId: chargeKey } })
        : null;
    const chargeMinor = charge?.status === 'paid' ? 0 : quote.chargeMinor;
    const creditMinor =
      quote.refundMinor > 0
        ? await this.refundableCredit(
            subscription,
            quote.refundMinor,
            changeRefundKey(subscription.id, seq),
            charge?.id ?? null
          )
        : 0;
    return {
      ...base,
      currency: quote.currency,
      creditMinor,
      chargeMinor,
      dueNowMinor: chargeMinor - creditMinor
    };
  }

  /** The refund leg `reserveProrationRefund` would reserve now, without a lock. */
  private async refundableCredit(
    subscription: Subscription,
    refundMinor: number,
    refundKey: string,
    excludeInvoiceId: string | null
  ): Promise<number> {
    const leg = await this.invoices.findOne({
      where: { providerEventId: refundKey }
    });
    if (leg && leg.status !== 'pending') return 0;
    const source = await this.invoices.findOne(
      this.refundLegSource(subscription, leg, excludeInvoiceId)
    );
    if (!source) return 0;
    if (leg) return leg.amountMinor.toNumber();
    return Math.min(refundMinor, remainingRefundable(source).toNumber());
  }

  /**
   * The source of a refund leg: the invoice that an earlier attempt reserved
   * against, else the proration refund source.
   */
  private refundLegSource(
    subscription: Subscription,
    leg: Invoice | null,
    excludeInvoiceId: string | null
  ): FindOneOptions<Invoice> {
    return leg
      ? {
          where: {
            subscriptionId: subscription.id,
            providerInvoiceRef: leg.providerInvoiceRef,
            status: 'paid'
          }
        }
      : this.prorationRefundSource(subscription, excludeInvoiceId);
  }

  /**
   * The invoice that paid for the outgoing plan's current coverage. The preview
   * and the executed refund must read the same row.
   */
  private prorationRefundSource(
    subscription: Subscription,
    excludeInvoiceId: string | null = null
  ): FindOneOptions<Invoice> {
    return {
      where: {
        subscriptionId: subscription.id,
        status: 'paid',
        billingMode: 'fixed',
        ...(excludeInvoiceId ? { id: Not(excludeInvoiceId) } : {})
      },
      order: { createdAt: 'DESC' }
    };
  }

  /** Resolves and guards everything a change/preview needs (shared path). */
  private async resolveChangeContext(
    userId: string,
    planKey: string
  ): Promise<ChangeContext> {
    const { customer, subscription } = await requireOpenSubscription(
      { customers: this.customers, subscriptions: this.subscriptions },
      userId,
      'No active subscription to change'
    );
    if (!CHANGEABLE_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
      throw new ApiError(
        ErrorKeys.BILLING.SUBSCRIPTION_NOT_CHANGEABLE,
        'The subscription must be active to change plans. Settle any outstanding payment first.'
      );
    }
    if (subscription.cancelAtPeriodEnd) {
      throw new ApiError(
        ErrorKeys.BILLING.CANCELLATION_SCHEDULED,
        'A cancellation is scheduled for this subscription; it can no longer change plans.'
      );
    }
    this.assertBeforeRenewal(subscription, new Date());

    const toPlan = await this.plans.findOne({ where: { key: planKey } });
    if (!toPlan || !toPlan.active) {
      throw planNotFound(planKey);
    }
    if (toPlan.key === subscription.planKey) {
      throw new ApiError(
        ErrorKeys.BILLING.SAME_PLAN,
        'You are already on this plan.'
      );
    }
    const toPrice = toPlan.prices[subscription.provider];
    if (!toPrice) {
      throw new ApiError(
        ErrorKeys.BILLING.PLAN_UNAVAILABLE_FOR_PROVIDER,
        `Plan "${toPlan.key}" is not available for your billing provider.`
      );
    }

    const fromPlan = await this.plans.findOne({
      where: { key: subscription.planKey }
    });
    if (!fromPlan) {
      throw currentPlanMissing();
    }

    const provider = this.billing.getProviderById(subscription.provider);

    return { customer, subscription, fromPlan, toPlan, toPrice, provider };
  }

  /**
   * Reserves the refund leg of a self-managed switch against the invoice that
   * paid for the outgoing plan's current coverage, capped by what is still
   * unrefunded on it (no source, or nothing left -> no refund, e.g. a period
   * opened by a zero usage invoice).
   *
   * The cap is applied and committed under the row lock, before the provider
   * call, so an admin refund of the same invoice either loses the race and
   * prices against this leg or wins it and shrinks this one. Reading the
   * remainder and writing it back around an HTTP round-trip would instead
   * overwrite whatever committed in between, and the erased amount could then
   * be paid out a second time.
   *
   * `excludeInvoiceId` keeps the caller's own charge leg out of the candidates,
   * so a switch can never refund the payment it just took. The id is matched
   * rather than the charge key because `provider_event_id` is nullable and a
   * `!=` on it would drop every row that has none.
   *
   * The leg row is written as `pending` in the same transaction as the
   * reservation. A retry of a switch that did not commit finds it under
   * `refundKey` and refunds the same amount from the same source instead of
   * reserving again; a leg that is already `refunded` is not refunded again.
   */
  private async reserveProrationRefund(
    subscription: Subscription,
    refundMinor: number,
    refundKey: string,
    excludeInvoiceId: string | null = null
  ): Promise<{ source: Invoice; minor: number; cumulative: Money } | null> {
    return withTransaction(this.dataSource, async (manager) => {
      const leg = await manager.findOne(Invoice, {
        where: { providerEventId: refundKey }
      });
      if (leg && leg.status !== 'pending') return null;

      const source = await lockInvoice(
        manager,
        this.refundLegSource(subscription, leg, excludeInvoiceId)
      );
      if (!source) return null;
      if (leg) {
        return {
          source,
          minor: leg.amountMinor.toNumber(),
          cumulative: source.refundedMinor
        };
      }

      // Capping silently is this leg's policy: a switch is not refused because
      // its source invoice has less left on it than the quote assumed.
      const { reserved, cumulative } = await reserveRefund(
        manager,
        source,
        Money.fromMinor(refundMinor)
      );
      const minor = reserved.toNumber();
      if (minor <= 0) return null;

      await this.insertChangeInvoice(manager, {
        subscription,
        providerEventId: refundKey,
        providerInvoiceRef: source.providerInvoiceRef,
        amountMinor: minor,
        currency: source.currency,
        billingMode: 'fixed'
      });
      return { source, minor, cumulative };
    });
  }

  /**
   * Gives a proration reservation back, and removes its `pending` leg row, when
   * its provider call failed. A release that itself fails is only logged: the
   * switch has already gone through, and an invoice showing more refunded than
   * was paid out is the safe direction to fail in.
   */
  private async releaseProrationRefund(
    sourceId: string,
    minor: number,
    refundKey: string
  ): Promise<void> {
    try {
      await withTransaction(this.dataSource, async (manager) => {
        await releaseRefund(manager, sourceId, Money.fromMinor(minor));
        await manager.delete(Invoice, {
          providerEventId: refundKey,
          status: 'pending'
        });
      });
    } catch (error) {
      this.logger.error(
        `Failed to release proration refund reservation of ${minor} minor on invoice ${sourceId}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Persists the new plan on the local row and publishes the change. A row that
   * moved while the provider was applying the change is left alone: the
   * provider's own webhook reconciles the local row from its snapshot.
   *
   * A switch from a usage plan closes its metered window here. The listener
   * runs after this commit, so the event names the outgoing plan to rate under.
   */
  private async applyPlanChange(
    ctx: ChangeContext,
    now: Date
  ): Promise<Subscription> {
    const { customer, subscription, fromPlan, toPlan } = ctx;
    const closesWindow = closesMeteredWindow(subscription, toPlan);
    const windowStart = meteredWindowStart(subscription);
    const saved = await this.commitPlanChange(
      this.dataSource.manager,
      subscription,
      toPlan,
      now
    );
    if (!saved) {
      throw new ApiError(
        ErrorKeys.BILLING.PLAN_CHANGE_CONFLICT,
        'This subscription changed while the plan change was in flight. Please retry.'
      );
    }
    this.events.emit(
      PlanChangedEvent.name,
      new PlanChangedEvent(customer.userId, saved.id, fromPlan.key, toPlan.key)
    );
    if (closesWindow) {
      this.events.emit(
        UsagePeriodClosedEvent.name,
        new UsagePeriodClosedEvent(
          customer.userId,
          saved.id,
          windowStart,
          now,
          fromPlan.key
        )
      );
    }
    return saved;
  }

  /**
   * Records the charge leg as a `pending` invoice BEFORE the provider is asked
   * for the money, so a request that dies between the capture and the closing
   * transaction - the provider deadline, a pool timeout, a restart - still
   * leaves the payment on the books. A plan change is user-driven and runs
   * once, so unlike a renewal there is no later scan to reconcile it, and an
   * unrecorded charge is not even refundable through the admin console (that
   * route is addressed by invoice id).
   *
   * Same construction as the usage close (`UsageInvoicingService`): the row
   * carries no provider ref yet - `recordChargeRef` writes the real one the
   * moment the provider answers - and a replayed change loses the `orIgnore`
   * insert and reuses the row already under the key. `paidRef` is the provider
   * reference of a reused row that is already `paid`: the caller must not ask
   * the provider for that money again.
   */
  private async plantChangeCharge(args: {
    subscription: Subscription;
    providerEventId: string;
    amountMinor: number;
    currency: string;
    billingMode: Plan['billingMode'];
  }): Promise<{ id: string | null; paidRef: string | null }> {
    const planted = await this.insertChangeInvoice(this.dataSource.manager, {
      ...args,
      providerInvoiceRef: ''
    });
    if (planted) {
      return { id: planted, paidRef: null };
    }
    const existing = await this.invoices.findOne({
      where: { providerEventId: args.providerEventId }
    });
    return {
      id: existing?.id ?? null,
      paidRef: existing?.status === 'paid' ? existing.providerInvoiceRef : null
    };
  }

  /**
   * Attaches the provider's payment reference to the planted row as soon as the
   * charge returns, in its own committed write. The status is left alone: the
   * row stays `pending` until the closing transaction settles it, which is what
   * keeps it out of the refund-source lookup that runs in between.
   */
  private async recordChargeRef(
    chargeKey: string,
    providerInvoiceRef: string
  ): Promise<void> {
    await this.invoices.update(
      { providerEventId: chargeKey },
      { providerInvoiceRef }
    );
  }

  /**
   * Marks the planted row failed, and only for a charge the provider refused
   * outright. Every other rejection leaves the outcome open - the deadline
   * bounds our call, not the provider's request - so the row stays `pending`
   * and the confirming webhook settles it if the money did move; writing
   * `failed` there would contradict a capture already in flight and block that
   * settle. A failure to record this is logged, never raised: the charge error
   * is what the caller must see.
   */
  private async failPlantedCharge(
    chargeKey: string,
    error: unknown
  ): Promise<void> {
    if (!(error instanceof ChargeDeclinedError)) {
      return;
    }
    try {
      await this.invoices.update(
        { providerEventId: chargeKey, status: 'pending' },
        { status: 'failed' }
      );
    } catch (updateError) {
      this.logger.error(
        `Failed to mark declined proration charge ${chargeKey} as failed: ${(updateError as Error).message}`
      );
    }
  }

  /**
   * Settles the planted charge leg once the funds are captured, guarded on the
   * status so the confirming webhook's identical flip and this one cannot both
   * win. Returns whether this call is the winner - the caller announces the
   * payment only then. A row left `failed` by a prior declined attempt settles
   * too (this one went through outside the provider's idempotence window); a
   * `paid` or `refunded` row is untouched.
   */
  private async settleChangeCharge(
    manager: EntityManager,
    chargeKey: string,
    providerInvoiceRef: string
  ): Promise<boolean> {
    const flip = await manager.update(
      Invoice,
      { providerEventId: chargeKey, status: In([...UNPAID_INVOICE_STATUSES]) },
      { status: 'paid', providerInvoiceRef, paidAt: new Date() }
    );
    return flip.affected === 1;
  }

  /**
   * Records one leg of a self-managed switch as its own `pending` invoice row
   * within the caller's transaction (the two fiscal documents of the switch stay
   * visible in the history); the caller settles it once the money moved. The
   * unique `providerEventId` makes a double-submitted change insert each leg at
   * most once.
   */
  private async insertChangeInvoice(
    manager: EntityManager,
    args: {
      subscription: Subscription;
      providerEventId: string;
      providerInvoiceRef: string;
      amountMinor: number;
      currency: string;
      billingMode: Plan['billingMode'];
    }
  ): Promise<string | null> {
    const { subscription } = args;
    const now = new Date();
    return insertInvoiceOnce(manager, {
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      provider: subscription.provider,
      providerEventId: args.providerEventId,
      providerInvoiceRef: args.providerInvoiceRef,
      amountMinor: Money.fromMinor(args.amountMinor),
      currency: args.currency,
      status: 'pending',
      billingMode: args.billingMode,
      periodStart: now,
      periodEnd: subscription.currentPeriodEnd,
      paidAt: null,
      receiptRef: null
    });
  }
}
