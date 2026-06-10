import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  UsagePeriodClosedEvent
} from '../events/billing.events';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from '../providers/payment-provider.interface';
import { UsageRating } from '../rating/usage-rating.strategy';

/**
 * Invoices a closed usage period of a provider-managed (Paddle) subscription
 * (design §17.3 — postpaid at the billing-cycle boundary). The flow is
 * exactly-once by construction: a pending `Invoice` keyed by the unique
 * `usage:{subscriptionId}:{periodEnd}` is inserted BEFORE the provider charge,
 * so a duplicate close (replayed/raced webhook) loses the insert and never
 * double-charges. The charge's `transaction.completed` webhook carries the key
 * back and the reducer settles the pending row; `payment.failed` marks it
 * failed (dunning for provider-managed subscriptions stays with the provider).
 * A zero-usage period needs no charge — the invoice is recorded paid at 0.
 */
@Injectable()
export class UsageInvoicingService {
  private readonly logger = new Logger(UsageInvoicingService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @Inject(BILLING_PROVIDERS)
    private readonly providers: PaymentProvider[],
    private readonly usageRating: UsageRating,
    private readonly events: EventEmitter2
  ) {}

  @OnEvent(UsagePeriodClosedEvent.name)
  async handlePeriodClosed(event: UsagePeriodClosedEvent): Promise<void> {
    try {
      await this.invoiceClosedPeriod(event);
    } catch (error) {
      // A listener must never break the webhook reduce that emitted the event.
      this.logger.error(
        `Usage invoicing failed for subscription ${event.subscriptionId}`,
        error as Error
      );
    }
  }

  async invoiceClosedPeriod(event: UsagePeriodClosedEvent): Promise<void> {
    const subscription = await this.subscriptions.findOne({
      where: { id: event.subscriptionId }
    });
    if (!subscription?.providerSubscriptionId) {
      this.logger.warn(
        `Skipping usage invoicing for ${event.subscriptionId}: subscription or provider reference missing`
      );
      return;
    }
    const customer = await this.customers.findOne({
      where: { id: subscription.customerId }
    });
    const plan = await this.plans.findOne({
      where: { key: subscription.planKey }
    });
    const provider = this.providers.find((p) => p.id === subscription.provider);
    if (!customer || !plan || !provider) {
      this.logger.warn(
        `Skipping usage invoicing for ${event.subscriptionId}: missing customer, plan or provider`
      );
      return;
    }

    const summary = await this.usageRating.summarizeForPeriod(
      subscription,
      plan,
      { start: event.periodStart, end: event.periodEnd }
    );
    const chargeKey = `usage:${subscription.id}:${event.periodEnd.getTime()}`;
    const zeroUsage = summary.amountMinor === 0;

    const insert = await this.invoices
      .createQueryBuilder()
      .insert()
      .into(Invoice)
      .values({
        customerId: subscription.customerId,
        subscriptionId: subscription.id,
        provider: subscription.provider,
        providerEventId: chargeKey,
        providerInvoiceRef: zeroUsage ? chargeKey : '',
        amountMinor: summary.amountMinor,
        currency: summary.currency,
        status: zeroUsage ? 'paid' : 'pending',
        billingMode: 'usage',
        periodStart: event.periodStart,
        periodEnd: event.periodEnd,
        paidAt: zeroUsage ? new Date() : null,
        receiptRef: null
      })
      .orIgnore()
      .returning(['id'])
      .execute();

    const rows = insert.raw as Array<{ id: string }>;
    if (rows.length === 0) {
      // This period close was already invoiced (replayed or raced) — done.
      return;
    }

    if (zeroUsage) {
      this.events.emit(
        InvoicePaidEvent.name,
        new InvoicePaidEvent(event.userId, rows[0].id)
      );
      return;
    }

    const description =
      summary.receiptItems[0]?.description ?? `${plan.name} usage`;
    try {
      await provider.chargeUsage(
        subscription.providerSubscriptionId,
        summary.amountMinor,
        summary.currency,
        description,
        chargeKey
      );
    } catch (error) {
      // The invoice stays `pending` for operator visibility: the provider may
      // or may not have accepted the charge (e.g. a network failure after
      // submission), so flipping it to `failed` here could contradict a
      // `transaction.completed` that is already in flight.
      this.logger.error(
        `Usage charge failed for subscription ${subscription.id} (${chargeKey})`,
        error as Error
      );
    }
  }
}
