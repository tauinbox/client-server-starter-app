import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Subscription } from '../entities/subscription.entity';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import type { CancelMode } from '../providers/payment-provider.interface';
import { BillingService } from '../billing.service';

/**
 * Admin-facing billing operations (design §11). Unlike `BillingUserService`,
 * reads and mutations here are addressed by entity id across all customers —
 * the CASL `manage Billing` permission, not per-caller scoping, is the access
 * boundary. Cancel/refund delegate the money side to the resolved provider and
 * mirror the self-service cancel semantics so entitlements stay consistent.
 */
@Injectable()
export class BillingAdminService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    private readonly billing: BillingService,
    private readonly events: EventEmitter2
  ) {}

  listSubscriptions(): Promise<Subscription[]> {
    return this.subscriptions.find({ order: { createdAt: 'DESC' } });
  }

  listInvoices(): Promise<Invoice[]> {
    return this.invoices.find({ order: { createdAt: 'DESC' } });
  }

  async cancelSubscription(
    id: string,
    mode: CancelMode = 'period_end'
  ): Promise<Subscription> {
    const subscription = await this.subscriptions.findOne({ where: { id } });
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    // Provider-managed lifecycle: ask the provider to cancel; the resulting
    // webhook reconciles status. Self-managed: there is no provider object — the
    // renewal scheduler simply stops charging the saved card.
    if (subscription.providerSubscriptionId) {
      const provider = this.billing.getProviderById(subscription.provider);
      if (provider) {
        await provider.cancel(subscription.providerSubscriptionId, mode);
      }
    }

    if (mode === 'immediate') {
      subscription.status = 'canceled';
      subscription.cancelAtPeriodEnd = false;
    } else {
      subscription.cancelAtPeriodEnd = true;
    }
    const saved = await this.subscriptions.save(subscription);

    // Immediate cancellation revokes access now, so the cached entitlements must
    // be invalidated; a period-end cancel keeps access until the period closes.
    if (mode === 'immediate') {
      const userId = await this.resolveUserId(saved.customerId);
      if (userId) {
        this.events.emit(
          SubscriptionCanceledEvent.name,
          new SubscriptionCanceledEvent(userId, saved.id)
        );
      }
    }
    return saved;
  }

  async refundInvoice(id: string, amountMinor?: number): Promise<Invoice> {
    const invoice = await this.invoices.findOne({ where: { id } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status !== 'paid') {
      throw new ConflictException('Only paid invoices can be refunded');
    }

    const refundAmount = amountMinor ?? invoice.amountMinor;
    if (refundAmount <= 0 || refundAmount > invoice.amountMinor) {
      throw new BadRequestException(
        'Refund amount must be between 1 and the invoice total'
      );
    }

    const provider = this.billing.getProviderById(invoice.provider);
    if (provider) {
      await provider.refund(
        invoice.providerInvoiceRef,
        refundAmount,
        `refund-${invoice.id}-${refundAmount}`
      );
    }

    // A full refund settles the invoice as `refunded`; a partial refund leaves it
    // `paid` (the M1 schema has no partial-refund status or refunded-amount column).
    if (refundAmount === invoice.amountMinor) {
      invoice.status = 'refunded';
    }
    return this.invoices.save(invoice);
  }

  private async resolveUserId(customerId: string): Promise<string | null> {
    const customer = await this.customers.findOne({
      where: { id: customerId },
      select: { id: true, userId: true }
    });
    return customer?.userId ?? null;
  }
}
