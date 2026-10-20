import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  IsNull,
  type EntityManager,
  type QueryDeepPartialEntity
} from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Money } from '@app/shared/utils/money';
import { meteredWindowStart } from '@app/shared/utils/billing-rules';
import { OPEN_SUBSCRIPTION_STATUSES } from '@app/shared/constants';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { Customer } from '../entities/customer.entity';
import { CustomerGrant } from '../entities/customer-grant.entity';
import { Invoice, UNPAID_INVOICE_STATUSES } from '../entities/invoice.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import { Plan } from '../entities/plan.entity';
import { Product } from '../entities/product.entity';
import { Subscription } from '../entities/subscription.entity';
import { MetricsService } from '../../core/metrics/metrics.service';
import { isPlantedBeforeCharge } from '../utils/charge-keys.util';
import { insertInvoiceOnce } from '../utils/invoice-insert.util';
import { CreditService } from '../services/credit.service';
import {
  FirstPaymentUnclaimedEvent,
  InvoicePaidEvent,
  PaymentFailedEvent,
  SubscriptionActivatedEvent,
  SubscriptionCanceledEvent,
  SubscriptionPastDueEvent,
  SubscriptionRenewedEvent,
  UsagePeriodClosedEvent
} from '../events/billing.events';
import { MANAGES_LIFECYCLE } from '../providers/payment-provider.interface';
import type {
  NormalizedCustomerRef,
  NormalizedEvent,
  NormalizedInvoicePayload,
  NormalizedPaymentFailedPayload,
  NormalizedPaymentMethodPayload,
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
 * The catalog row whose provider price carries one of `priceIds`. Inactive
 * rows match too: a retired plan keeps its subscribers, and a product retired
 * after the payment was still paid for.
 */
function findByPriceId<T>(
  rows: T[],
  priceIds: string[],
  priceIdOf: (row: T) => string | undefined
): T | null {
  return (
    rows.find((row) => {
      const priceId = priceIdOf(row);
      return priceId !== undefined && priceIds.includes(priceId);
    }) ?? null
  );
}

function lifecycleOwnerFor(provider: BillingProviderId): 'provider' | 'self' {
  return MANAGES_LIFECYCLE[provider] ? 'provider' : 'self';
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
    private readonly credits: CreditService,
    private readonly events: EventEmitter2,
    private readonly metrics: MetricsService
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
      case 'payment_method.updated':
        await this.reducePaymentMethodUpdated(
          event.provider,
          event.payload as NormalizedPaymentMethodPayload
        );
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

  /**
   * The plan a subscription snapshot was charged for. No match means a plan
   * with no price id for this provider, so the snapshot leaves the plan as it
   * is and the gap is reported.
   */
  private async planForPrices(
    manager: EntityManager,
    provider: BillingProviderId,
    payload: NormalizedSubscriptionPayload
  ): Promise<Plan | null> {
    const plan = findByPriceId(
      await manager.find(Plan),
      payload.providerPriceIds,
      (row) => row.prices[provider]?.providerPriceId
    );
    if (!plan) {
      this.logger.error(
        `Subscription ${payload.providerSubscriptionId}: no plan has the ${provider} price [${payload.providerPriceIds.join(', ')}]`
      );
    }
    return plan;
  }

  /**
   * The product a one-time payment bought: named by `productId` when our
   * server wrote it, else matched by the catalog price that was paid.
   */
  private async purchasedProduct(
    manager: EntityManager,
    provider: BillingProviderId,
    payload: NormalizedInvoicePayload
  ): Promise<Product | null> {
    const product = payload.productId
      ? await manager.findOne(Product, { where: { id: payload.productId } })
      : findByPriceId(
          await manager.find(Product),
          payload.providerPriceIds ?? [],
          (row) => row.prices[provider]?.paddlePriceId
        );
    if (!product) {
      this.logger.error(
        `One-time payment ${payload.providerInvoiceRef}: no product matches it, nothing is granted`
      );
    }
    return product;
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
      const plan = await this.planForPrices(manager, provider, payload);

      const subscription = await manager.findOne(Subscription, {
        where: { providerSubscriptionId: payload.providerSubscriptionId }
      });

      if (!subscription) {
        if (!plan) {
          return null;
        }
        // 1:1 invariant (UQ_subscriptions_customer_open): a customer who already
        // has an open subscription must not get a second one. Skip + warn rather
        // than let the insert abort the whole webhook transaction.
        const openExisting = await manager.findOne(Subscription, {
          where: {
            customerId: payload.ref.customerId,
            status: In([...OPEN_SUBSCRIPTION_STATUSES])
          }
        });
        if (openExisting) {
          this.logger.warn(
            `Skipping ${type} for ${payload.providerSubscriptionId}: customer ${payload.ref.customerId} already has open subscription ${openExisting.id}`
          );
          return null;
        }
        const lifecycleOwner = lifecycleOwnerFor(provider);
        const periodStart = parseDate(payload.currentPeriodStart, now);
        const created = await manager.save(
          manager.create(Subscription, {
            customerId: payload.ref.customerId,
            planKey: plan.key,
            provider,
            billingMode: plan.billingMode,
            status: payload.status,
            lifecycleOwner,
            currentPeriodStart: periodStart,
            currentPeriodEnd: parseDate(payload.currentPeriodEnd, now),
            // Only the self-managed scheduler derives boundaries; a
            // provider-owned row takes each one from the provider's snapshot.
            billingAnchorAt: lifecycleOwner === 'self' ? periodStart : null,
            cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
            trialEnd: payload.trialEnd ? new Date(payload.trialEnd) : null,
            providerSubscriptionId: payload.providerSubscriptionId,
            paymentMethodId: null
          })
        );
        if (payload.status === 'trialing') {
          await this.markTrialUsed(manager, created.customerId, now);
        }
        return { subscriptionId: created.id, userId, closedPeriod: null };
      }

      const incomingStart = payload.currentPeriodStart
        ? new Date(payload.currentPeriodStart)
        : null;
      const rollsOver =
        incomingStart !== null &&
        !Number.isNaN(incomingStart.getTime()) &&
        incomingStart.getTime() >= subscription.currentPeriodEnd.getTime();
      // A provider-managed metered period closes either way: the snapshot
      // starts a new one at/after the stored boundary, or it cancels the
      // subscription - a case the rollover predicate never matches. Keyed on
      // the stored boundary, so a replay neither re-detects nor charges twice.
      const meteredClose =
        subscription.billingMode === 'usage' &&
        subscription.lifecycleOwner === 'provider';
      const closesPeriod =
        meteredClose && (type === 'subscription.canceled' || rollsOver);
      // A plan change whose local write missed its guard reaches the row only
      // through this snapshot, so a switch of billing mode is applied here.
      const toPlan = plan && plan.key !== subscription.planKey ? plan : null;
      const switchesMode =
        toPlan !== null && toPlan.billingMode !== subscription.billingMode;
      const closeEnd = closesPeriod
        ? subscription.currentPeriodEnd
        : switchesMode && meteredClose && !rollsOver
          ? now
          : null;
      // Rated under the stored plan: the snapshot may already carry the next.
      const closedPeriod = closeEnd
        ? {
            start: meteredWindowStart(subscription),
            end: closeEnd,
            planKey: subscription.planKey
          }
        : null;

      // By name, not by saving the entity: a whole-row diff would push the
      // values read before the awaits above back over anything a concurrent
      // writer committed meanwhile (dunning, `version`, the payment method).
      const snapshot: QueryDeepPartialEntity<Subscription> = {
        status: payload.status,
        cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
        trialEnd: payload.trialEnd ? new Date(payload.trialEnd) : null
      };
      if (toPlan) {
        snapshot.planKey = toPlan.key;
      }
      if (payload.currentPeriodStart) {
        snapshot.currentPeriodStart = new Date(payload.currentPeriodStart);
      }
      if (payload.currentPeriodEnd) {
        snapshot.currentPeriodEnd = new Date(payload.currentPeriodEnd);
      }
      if (switchesMode) {
        snapshot.billingMode = toPlan.billingMode;
        snapshot.meteredFrom = now;
      }
      if (rollsOver) {
        snapshot.meteredFrom = null;
      }
      await manager.update(Subscription, { id: subscription.id }, snapshot);
      if (payload.status === 'canceled') {
        await this.credits.releaseHolds(manager, {
          subscriptionId: subscription.id
        });
      }
      if (payload.status === 'trialing') {
        await this.markTrialUsed(manager, subscription.customerId, now);
      }
      return { subscriptionId: subscription.id, userId, closedPeriod };
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
          result.closedPeriod.end,
          result.closedPeriod.planKey
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

  /**
   * Compares what the provider says it captured against what the core recorded
   * for that charge. A divergence means the money moved is not the money billed
   * (a mis-rated charge, a provider-side amount edit, or a chargeKey collision),
   * which no automated path can safely resolve: the recorded amount is the one
   * that was receipted, so it is kept and the settle proceeds - the mismatch is
   * surfaced for an operator instead of being silently absorbed.
   */
  private reconcileChargeAmount(
    invoice: Invoice,
    payload: NormalizedInvoicePayload
  ): void {
    const recorded = invoice.amountMinor.toNumber();
    const reported = payload.amountMinor;
    const sameCurrency =
      invoice.currency.toUpperCase() === payload.currency.toUpperCase();
    if (recorded === reported && sameCurrency) {
      return;
    }
    this.logger.error(
      `Invoice ${invoice.id} settled from ${payload.providerInvoiceRef} with a mismatched amount: ` +
        `recorded ${recorded} ${invoice.currency}, provider reported ${reported} ${payload.currency}`
    );
  }

  /**
   * A settled off-session charge that closed no unpaid invoice. For a flow
   * that plants its row before charging this is money the core cannot account
   * for when nothing was ever recorded under the key, or when the recorded row
   * holds another payment - so it is reported at `error` with a counter behind
   * it. A row already settled with this payment is a repeat delivery and stays
   * silent. It stays a report, never a throw: throwing would leave the
   * delivery `received` and the reconciliation sweep would replay it forever.
   */
  private reportUnsettledCharge(
    provider: BillingProviderId,
    chargeKey: string,
    recorded: Invoice | null,
    payload: NormalizedInvoicePayload
  ): void {
    if (
      !isPlantedBeforeCharge(chargeKey) ||
      recorded?.providerInvoiceRef === payload.providerInvoiceRef
    ) {
      return;
    }
    this.metrics.recordUnmatchedOffSessionCharge(provider);
    this.logger.error(
      `Off-session charge ${payload.providerInvoiceRef} (${chargeKey}) settled onto no pending invoice: ` +
        `${payload.amountMinor} ${payload.currency} was captured with nothing to close`
    );
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

    // The core already recorded this off-session charge's invoice: settle an
    // unpaid one, otherwise only reconcile the payment ref. A `failed` row
    // settles too - a charge that threw can still be captured. Never insert
    // here - that would claim the unique key the period-advance relies on.
    if (payload.offSessionChargeKey) {
      const chargeKey = payload.offSessionChargeKey;
      const settled = await withTransaction(
        this.dataSource,
        async (manager) => {
          const flip = await manager.update(
            Invoice,
            {
              providerEventId: chargeKey,
              status: In([...UNPAID_INVOICE_STATUSES])
            },
            {
              status: 'paid',
              providerInvoiceRef: payload.providerInvoiceRef,
              paidAt: parseDate(payload.paidAt, new Date())
            }
          );
          if (!flip.affected) {
            const recorded = await manager.findOne(Invoice, {
              where: { providerEventId: chargeKey }
            });
            await manager.update(
              Invoice,
              { providerEventId: chargeKey },
              { providerInvoiceRef: payload.providerInvoiceRef }
            );
            this.reportUnsettledCharge(provider, chargeKey, recorded, payload);
            return null;
          }
          const invoice = await manager.findOne(Invoice, {
            where: { providerEventId: chargeKey }
          });
          if (!invoice) {
            return null;
          }
          this.reconcileChargeAmount(invoice, payload);
          // The winning flip to paid spends the credits the charged amount
          // was rated against - exactly once, whichever side settles.
          if (invoice.creditUnitsApplied > 0) {
            await this.credits.spendOnUsage(
              manager,
              invoice.customerId,
              invoice.id,
              invoice.creditUnitsApplied
            );
          }
          const userId = await this.resolveUserId(manager, payload.ref);
          return { invoiceId: invoice.id, userId };
        }
      );
      if (settled?.userId) {
        this.events.emit(
          InvoicePaidEvent.name,
          new InvoicePaidEvent(settled.userId, settled.invoiceId)
        );
      }
      return;
    }

    const result = await withTransaction(this.dataSource, async (manager) => {
      const userId = await this.resolveUserId(manager, payload.ref);
      const now = new Date();

      // A postpaid usage charge round-trips its `usage:{sub}:{periodEnd}` key
      // through the provider's price custom data; the payment settles the
      // planted invoice, `failed` included because Paddle retries a charge.
      if (payload.usageChargeKey) {
        const reconciled = await manager.update(
          Invoice,
          {
            providerEventId: payload.usageChargeKey,
            status: In([...UNPAID_INVOICE_STATUSES])
          },
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
          if (reconciled.affected && invoice.creditUnitsApplied > 0) {
            await this.credits.spendOnUsage(
              manager,
              invoice.customerId,
              invoice.id,
              invoice.creditUnitsApplied
            );
          }
          // No pending row matched but the invoice exists — an already-settled
          // replay; never insert a duplicate alongside it.
          return reconciled.affected
            ? {
                invoiceId: invoice.id,
                userId,
                activatedSubscriptionId: null,
                unclaimed: false
              }
            : null;
        }
        // The keyed invoice vanished — fall through to the plain insert so the
        // payment is still recorded.
      }

      // A one-time purchase belongs to no subscription — it must never match
      // the self-managed open-subscription fallback below (which would
      // activate it). Provider-managed invoices link by the provider
      // subscription id; a self-managed (YooKassa) first payment has none, so
      // the incomplete subscription created at checkout is found by customer id.
      const oneTime = payload.kind === 'one_time';
      const product = oneTime
        ? await this.purchasedProduct(manager, provider, payload)
        : null;
      const subscription = oneTime
        ? null
        : payload.providerSubscriptionId
          ? await manager.findOne(Subscription, {
              where: { providerSubscriptionId: payload.providerSubscriptionId }
            })
          : selfManaged
            ? await manager.findOne(Subscription, {
                where: {
                  customerId,
                  status: In([...OPEN_SUBSCRIPTION_STATUSES])
                },
                order: { createdAt: 'DESC' }
              })
            : null;

      // No id on a replayed event: the unique provider_event_id gates the
      // whole reduce, so the activation/grant below runs exactly once per
      // paid invoice.
      const invoiceId = await insertInvoiceOnce(manager, {
        customerId,
        subscriptionId: subscription?.id ?? null,
        provider,
        providerEventId,
        providerInvoiceRef: payload.providerInvoiceRef,
        amountMinor: Money.fromMinor(payload.amountMinor),
        currency: payload.currency,
        status: 'paid',
        billingMode: subscription?.billingMode ?? 'fixed',
        kind: oneTime ? 'one_time' : 'subscription',
        productId: product?.id ?? null,
        periodStart: parseDate(payload.periodStart, now),
        periodEnd: parseDate(payload.periodEnd, now),
        paidAt: parseDate(payload.paidAt, now),
        receiptRef: null
      });
      if (!invoiceId) {
        return null;
      }

      if (oneTime) {
        await this.applyOneTimeGrant(
          manager,
          customerId,
          invoiceId,
          product,
          now
        );
        return {
          invoiceId,
          userId,
          activatedSubscriptionId: null,
          unclaimed: false
        };
      }

      const activatedSubscriptionId =
        selfManaged && subscription
          ? await this.activateSelfManaged(manager, subscription, payload, now)
          : null;
      // A trial binding moves no money, so there is nothing to give back.
      const unclaimed =
        selfManaged && !activatedSubscriptionId && payload.amountMinor > 0;

      return { invoiceId, userId, activatedSubscriptionId, unclaimed };
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
    if (result.unclaimed) {
      this.events.emit(
        FirstPaymentUnclaimedEvent.name,
        new FirstPaymentUnclaimedEvent(result.userId, result.invoiceId)
      );
    }
  }

  /**
   * Applies the purchased product's effect once per paid one-time invoice:
   * an `sku` product inserts a `CustomerGrant` (expiry from
   * `grant.durationDays`, else permanent); a `credits` pack tops up the
   * prepaid balance; `custom` carries no grant. Idempotency comes from the
   * caller — the grant runs only when the invoice insert won the unique
   * `provider_event_id` race.
   */
  private async applyOneTimeGrant(
    manager: EntityManager,
    customerId: string,
    invoiceId: string,
    product: Product | null,
    now: Date
  ): Promise<void> {
    if (!product?.grant) {
      return;
    }

    if (product.type === 'credits' && product.grant.credits) {
      await this.credits.addPurchase(
        manager,
        customerId,
        invoiceId,
        product.grant.credits
      );
      return;
    }

    if (product.type !== 'sku' || !product.grant.entitlement) {
      return;
    }
    const { entitlement, durationDays } = product.grant;
    await manager.save(
      manager.create(CustomerGrant, {
        customerId,
        entitlement,
        sourceInvoiceId: invoiceId,
        expiresAt: durationDays
          ? new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)
          : null,
        revokedAt: null
      })
    );
  }

  /**
   * Self-managed first-payment activation: flip the subscription out of
   * `incomplete` (to `trialing` while a trial is still running, else `active`),
   * then persist the saved card as the customer's default `PaymentMethod` and
   * point the subscription at it. Idempotency is guaranteed by the caller's
   * invoice insert.
   *
   * Returns `null`, and stores no card, when the row is no longer the
   * `incomplete` one this payment was opened for: another first payment
   * activated it, a later checkout moved it to another plan, or a cancel
   * landed. Postgres re-checks the predicate after the row lock, so of two
   * concurrent first payments only one activates.
   */
  private async activateSelfManaged(
    manager: EntityManager,
    subscription: Subscription,
    payload: NormalizedInvoicePayload,
    now: Date
  ): Promise<string | null> {
    const trialing =
      subscription.trialEnd != null &&
      subscription.trialEnd.getTime() > now.getTime();
    const applied = await manager.update(
      Subscription,
      {
        id: subscription.id,
        status: 'incomplete',
        ...(payload.planKey ? { planKey: payload.planKey } : {})
      },
      { status: trialing ? 'trialing' : 'active' }
    );
    if (!applied.affected) {
      return null;
    }
    if (trialing) {
      await this.markTrialUsed(manager, subscription.customerId, now);
    }

    if (payload.savedPaymentMethod) {
      // Demote the current default before inserting the new one (mirrors
      // reducePaymentMethodUpdated) so defaults never accumulate.
      await manager.update(
        PaymentMethod,
        { customerId: subscription.customerId, isDefault: true },
        { isDefault: false }
      );
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
      await manager.update(
        Customer,
        { id: subscription.customerId },
        { defaultPaymentMethodId: method.id }
      );
      await manager.update(
        Subscription,
        { id: subscription.id },
        { paymentMethodId: method.id }
      );
    }
    return subscription.id;
  }

  /** Keeps the first moment: a replayed or later trial does not move it. */
  private async markTrialUsed(
    manager: EntityManager,
    customerId: string,
    now: Date
  ): Promise<void> {
    await manager.update(
      Customer,
      { id: customerId, trialUsedAt: IsNull() },
      { trialUsedAt: now }
    );
  }

  /**
   * Default-method swap from a self-managed (YooKassa) method-update re-bind:
   * the new card replaces the old default — previous methods are
   * kept but demoted, the customer's autopay pointer and the open
   * subscription's bookkeeping reference move to the new row. No invoice is
   * written and the subscription status is untouched (a past_due subscription
   * stays past_due until the renewal retry actually charges the new card).
   * Idempotency is event-level: the `billing_webhook_events` unique key gates
   * a replayed delivery upstream.
   */
  private async reducePaymentMethodUpdated(
    provider: BillingProviderId,
    payload: NormalizedPaymentMethodPayload
  ): Promise<void> {
    const customerId = payload.ref.customerId;
    const saved = payload.savedPaymentMethod;
    if (!customerId || !saved) {
      this.logger.warn(
        'Skipping payment_method.updated: no customer reference or saved method'
      );
      return;
    }

    await withTransaction(this.dataSource, async (manager) => {
      await manager.update(
        PaymentMethod,
        { customerId, isDefault: true },
        { isDefault: false }
      );
      const method = await manager.save(
        manager.create(PaymentMethod, {
          customerId,
          provider,
          providerMethodRef: saved.providerMethodRef,
          brand: saved.brand,
          last4: saved.last4,
          isDefault: true
        })
      );
      await manager.update(
        Customer,
        { id: customerId },
        { defaultPaymentMethodId: method.id }
      );

      const subscription = await manager.findOne(Subscription, {
        where: { customerId, status: In([...OPEN_SUBSCRIPTION_STATUSES]) },
        order: { createdAt: 'DESC' }
      });
      if (subscription) {
        // Repeating the open-status predicate on the write is what keeps a
        // cancel that commits during this reduce from being rolled back: only
        // the pointer moves, and only while the subscription is still open.
        await manager.update(
          Subscription,
          { id: subscription.id, status: In([...OPEN_SUBSCRIPTION_STATUSES]) },
          { paymentMethodId: method.id }
        );
      }
    });
  }

  private async reducePaymentFailed(
    payload: NormalizedPaymentFailedPayload
  ): Promise<void> {
    // An off-session charge canceled at capture fails the pending invoice the
    // core recorded, silently: the renewal scheduler observes the failed row
    // on its next scan and walks dunning (emitting PaymentFailedEvent there);
    // a second event here would double-notify.
    if (payload.offSessionChargeKey) {
      const chargeKey = payload.offSessionChargeKey;
      await withTransaction(this.dataSource, (manager) =>
        manager.update(
          Invoice,
          { providerEventId: chargeKey, status: 'pending' },
          { status: 'failed' }
        )
      );
      return;
    }

    const failed = await withTransaction(this.dataSource, async (manager) => {
      const subscription = payload.providerSubscriptionId
        ? await manager.findOne(Subscription, {
            where: { providerSubscriptionId: payload.providerSubscriptionId }
          })
        : null;

      // The failed row keeps its credit hold while Paddle retries. A canceled
      // subscription has no later release point, so its hold ends here.
      if (payload.usageChargeKey) {
        const flip = await manager.update(
          Invoice,
          { providerEventId: payload.usageChargeKey, status: 'pending' },
          { status: 'failed' }
        );
        if (flip.affected && subscription?.status === 'canceled') {
          await this.credits.releaseHolds(manager, {
            providerEventId: payload.usageChargeKey
          });
        }
      }

      const userId = await this.resolveUserId(manager, payload.ref);
      if (!userId) {
        return null;
      }
      return { userId, subscriptionId: subscription?.id ?? null };
    });

    if (!failed) {
      return;
    }

    this.events.emit(
      PaymentFailedEvent.name,
      new PaymentFailedEvent(failed.userId, failed.subscriptionId)
    );
  }
}
