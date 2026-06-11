import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { CustomerGrant } from '../entities/customer-grant.entity';
import { Invoice } from '../entities/invoice.entity';
import { Product } from '../entities/product.entity';
import { Subscription } from '../entities/subscription.entity';
import { EntitlementService } from '../entitlements/entitlement.service';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import type { CancelMode } from '../providers/payment-provider.interface';
import { BillingService } from '../billing.service';
import { CreditService } from './credit.service';

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
    @InjectRepository(CustomerGrant)
    private readonly grants: Repository<CustomerGrant>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly billing: BillingService,
    private readonly entitlements: EntitlementService,
    private readonly credits: CreditService,
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
      await this.revokeOneTimeGrants(invoice);
      await this.clawbackCreditPurchase(invoice);
    }
    return this.invoices.save(invoice);
  }

  /**
   * Refunding a one-time purchase in full takes back what it granted (design
   * §20.5): the sku's `CustomerGrant` is revoked and the buyer's cached
   * entitlements are dropped. A `custom` purchase has no grants — nothing
   * matches and the refund stays a plain money move. Partial refunds keep the
   * invoice `paid`, so the grant survives them by construction.
   */
  private async revokeOneTimeGrants(invoice: Invoice): Promise<void> {
    if (invoice.kind !== 'one_time') {
      return;
    }
    const revoked = await this.grants.update(
      { sourceInvoiceId: invoice.id, revokedAt: IsNull() },
      { revokedAt: new Date() }
    );
    if (!revoked.affected) {
      return;
    }
    const userId = await this.resolveUserId(invoice.customerId);
    if (userId) {
      await this.entitlements.invalidateUser(userId);
    }
  }

  /**
   * Refunding a credit-pack purchase in full takes the granted units back:
   * the balance is decremented by the pack size and the deduction journaled
   * as a `refund` ledger entry. Already-spent credits drive the balance
   * negative, which blocks further usage until topped up — there is no
   * auto-debt write-off. Exactly-once application is guaranteed by the
   * invoice's one-way `paid → refunded` flip guarded above.
   */
  private async clawbackCreditPurchase(invoice: Invoice): Promise<void> {
    if (invoice.kind !== 'one_time' || !invoice.productId) {
      return;
    }
    const product = await this.products.findOne({
      where: { id: invoice.productId }
    });
    if (product?.type !== 'credits' || !product.grant?.credits) {
      return;
    }
    await this.credits.clawbackPurchase(
      invoice.customerId,
      invoice.id,
      product.grant.credits
    );
  }

  private async resolveUserId(customerId: string): Promise<string | null> {
    const customer = await this.customers.findOne({
      where: { id: customerId },
      select: { id: true, userId: true }
    });
    return customer?.userId ?? null;
  }
}
