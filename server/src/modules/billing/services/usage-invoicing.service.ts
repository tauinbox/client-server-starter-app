import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { withTransaction } from '../../../common/utils/with-transaction.util';
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
import { CreditService } from './credit.service';

/**
 * Invoices a closed usage period of a provider-managed (Paddle) subscription
 * (postpaid at the billing-cycle boundary). The flow is
 * exactly-once by construction: a pending `Invoice` keyed by the unique
 * `usage:{subscriptionId}:{periodEnd}` is inserted BEFORE the provider charge,
 * so a duplicate close (replayed/raced webhook) loses the insert and never
 * double-charges. The charge's `transaction.completed` webhook carries the key
 * back and the reducer settles the pending row; `payment.failed` marks it
 * failed (dunning for provider-managed subscriptions stays with the provider).
 * Prepaid credits offset billable units first — they are deducted in the same
 * transaction as the winning insert. A period whose charge nets to zero (no
 * usage, or credits cover it all) skips the provider and is recorded paid at 0.
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
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(BILLING_PROVIDERS)
    private readonly providers: PaymentProvider[],
    private readonly usageRating: UsageRating,
    private readonly credits: CreditService,
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

    const chargeKey = `usage:${subscription.id}:${event.periodEnd.getTime()}`;

    // Read, rate against, and deduct the credit balance in one FOR-UPDATE-locked
    // transaction so concurrent closes for the same customer serialize: the
    // second rates against the balance the first already spent (deduction gated
    // on the winning insert, so a replay spends nothing twice).
    const result = await withTransaction(this.dataSource, async (manager) => {
      const availableCredits = await this.credits.availableUnitsForUpdate(
        manager,
        subscription.customerId
      );
      const summary = await this.usageRating.summarizeForPeriodWithCredits(
        subscription,
        plan,
        { start: event.periodStart, end: event.periodEnd },
        availableCredits
      );
      const zeroCharge = summary.amountMinor === 0;

      const insert = await manager
        .createQueryBuilder()
        .insert()
        .into(Invoice)
        .values({
          customerId: subscription.customerId,
          subscriptionId: subscription.id,
          provider: subscription.provider,
          providerEventId: chargeKey,
          providerInvoiceRef: zeroCharge ? chargeKey : '',
          amountMinor: Money.fromMinor(summary.amountMinor),
          currency: summary.currency,
          status: zeroCharge ? 'paid' : 'pending',
          billingMode: 'usage',
          periodStart: event.periodStart,
          periodEnd: event.periodEnd,
          paidAt: zeroCharge ? new Date() : null,
          receiptRef: null
        })
        .orIgnore()
        .returning(['id'])
        .execute();

      const rows = insert.raw as Array<{ id: string }>;
      if (rows.length === 0) {
        return null;
      }
      if (summary.creditUnitsApplied > 0) {
        await this.credits.spendOnUsage(
          manager,
          subscription.customerId,
          rows[0].id,
          summary.creditUnitsApplied
        );
      }
      return { invoiceId: rows[0].id, summary, zeroCharge };
    });

    if (!result) {
      // This period close was already invoiced (replayed or raced) — done.
      return;
    }

    const { invoiceId, summary, zeroCharge } = result;

    if (zeroCharge) {
      this.events.emit(
        InvoicePaidEvent.name,
        new InvoicePaidEvent(event.userId, invoiceId)
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
