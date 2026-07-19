import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { Customer } from '../entities/customer.entity';
import { CustomerGrant } from '../entities/customer-grant.entity';
import { Invoice } from '../entities/invoice.entity';
import { Product } from '../entities/product.entity';
import { Subscription } from '../entities/subscription.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { EntitlementService } from '../entitlements/entitlement.service';
import { SubscriptionCanceledEvent } from '../events/billing.events';
import type { CancelMode } from '../providers/payment-provider.interface';
import { BillingService } from '../billing.service';
import { CreditService } from './credit.service';

const ZERO = Money.fromMinor(0);

/**
 * Admin-facing billing operations. Unlike `BillingUserService`,
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
    @InjectRepository(WebhookEvent)
    private readonly webhookEvents: Repository<WebhookEvent>,
    private readonly billing: BillingService,
    private readonly entitlements: EntitlementService,
    private readonly credits: CreditService,
    private readonly events: EventEmitter2,
    @InjectDataSource() private readonly dataSource: DataSource
  ) {}

  listSubscriptions(): Promise<Subscription[]> {
    return this.subscriptions.find({ order: { createdAt: 'DESC' } });
  }

  listInvoices(): Promise<Invoice[]> {
    return this.invoices.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Requeues a quarantined webhook delivery: resets a `dead_letter` row to
   * `received` (and zeroes its failure history) so the reconciliation sweep
   * picks it up again. The reduce is idempotent, so this can never double-apply
   * an effect. Only `dead_letter` rows are eligible — a `received` row is still
   * being swept and a `processed` one is already settled.
   */
  async replayWebhookEvent(
    id: string
  ): Promise<{ id: string; status: string }> {
    const event = await this.webhookEvents.findOne({
      where: { id },
      select: { id: true, status: true }
    });
    if (!event) {
      throw new NotFoundException('Webhook event not found');
    }
    if (event.status !== 'dead_letter') {
      throw new ConflictException(
        'Only dead-lettered webhook events can be replayed'
      );
    }
    await this.webhookEvents.update(
      { id },
      { status: 'received', attempts: 0, lastError: null }
    );
    return { id, status: 'received' };
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
    // Price the leg under a short row lock, released before the provider leg:
    // a provider HTTP call held inside an open transaction pins a pool
    // connection for the whole round-trip.
    const { alreadyRefunded, refundAmount, cumulativeRefunded, providerRef } =
      await withTransaction(this.dataSource, async (manager) => {
        const invoice = await manager.findOne(Invoice, {
          where: { id },
          lock: { mode: 'pessimistic_write' }
        });
        if (!invoice) {
          throw new NotFoundException('Invoice not found');
        }
        if (invoice.status !== 'paid') {
          throw new ConflictException('Only paid invoices can be refunded');
        }

        const alreadyRefunded = invoice.refundedMinor;
        const remaining = invoice.amountMinor.sub(alreadyRefunded);
        const refundAmount =
          amountMinor != null ? Money.fromMinor(amountMinor) : remaining;
        if (
          refundAmount.compare(ZERO) <= 0 ||
          refundAmount.compare(remaining) > 0
        ) {
          throw new BadRequestException(
            'Refund amount must be between 1 and the remaining refundable total'
          );
        }

        return {
          alreadyRefunded,
          refundAmount,
          cumulativeRefunded: alreadyRefunded.add(refundAmount),
          providerRef: {
            provider: invoice.provider,
            invoiceRef: invoice.providerInvoiceRef
          }
        };
      });

    const provider = this.billing.getProviderById(providerRef.provider);
    if (provider) {
      // Keying on the cumulative-after total makes a post-crash retry reuse
      // the same key and dedup at the provider.
      await provider.refund(
        providerRef.invoiceRef,
        refundAmount.toNumber(),
        `refund-${id}-${cumulativeRefunded.toMinorString()}`
      );
    }

    // Re-lock and reconcile against whatever landed while the lock was
    // released.
    const { saved, invalidateUserId } = await withTransaction(
      this.dataSource,
      async (manager) => {
        const invoice = await manager.findOne(Invoice, {
          where: { id },
          lock: { mode: 'pessimistic_write' }
        });
        if (!invoice) {
          throw new NotFoundException('Invoice not found');
        }

        // A concurrent leg from the same base with the same amount shared our
        // idempotency key, so the provider collapsed both calls into one money
        // move already recorded by that leg - recording ours would double it.
        const interleaved = invoice.refundedMinor.sub(alreadyRefunded);
        if (interleaved.compare(refundAmount) === 0) {
          return { saved: invoice, invalidateUserId: null };
        }

        const newCumulative = invoice.refundedMinor.add(refundAmount);
        if (newCumulative.compare(invoice.amountMinor) > 0) {
          throw new ConflictException(
            'Concurrent refunds exceeded the invoice total; reconcile against the provider'
          );
        }
        invoice.refundedMinor = newCumulative;

        // The one-way `paid -> refunded` flip keeps grant revoke / credit
        // clawback exactly-once across multiple partial legs.
        let invalidateUserId: string | null = null;
        if (
          newCumulative.compare(invoice.amountMinor) >= 0 &&
          invoice.status === 'paid'
        ) {
          invoice.status = 'refunded';
          invalidateUserId = await this.revokeOneTimeGrants(manager, invoice);
          await this.clawbackCreditPurchase(manager, invoice);
        }
        const saved = await manager.save(Invoice, invoice);
        return { saved, invalidateUserId };
      }
    );

    // Cache invalidation is non-transactional — only after a durable commit.
    if (invalidateUserId) {
      await this.entitlements.invalidateUser(invalidateUserId);
    }
    return saved;
  }

  /**
   * Refunding a one-time purchase in full takes back what it granted: the
   * sku's `CustomerGrant` is revoked and the buyer's cached
   * entitlements are dropped. A `custom` purchase has no grants — nothing
   * matches and the refund stays a plain money move. Partial refunds keep the
   * invoice `paid`, so the grant survives them by construction.
   */
  private async revokeOneTimeGrants(
    manager: EntityManager,
    invoice: Invoice
  ): Promise<string | null> {
    if (invoice.kind !== 'one_time') {
      return null;
    }
    const revoked = await manager.update(
      CustomerGrant,
      { sourceInvoiceId: invoice.id, revokedAt: IsNull() },
      { revokedAt: new Date() }
    );
    if (!revoked.affected) {
      return null;
    }
    return this.resolveUserId(invoice.customerId);
  }

  /**
   * Refunding a credit-pack purchase in full takes the granted units back:
   * the balance is decremented by the pack size and the deduction journaled
   * as a `refund` ledger entry. Already-spent credits drive the balance
   * negative, which blocks further usage until topped up — there is no
   * auto-debt write-off. Exactly-once application is guaranteed by the
   * invoice's one-way `paid → refunded` flip guarded above.
   */
  private async clawbackCreditPurchase(
    manager: EntityManager,
    invoice: Invoice
  ): Promise<void> {
    if (invoice.kind !== 'one_time' || !invoice.productId) {
      return;
    }
    const product = await manager.findOne(Product, {
      where: { id: invoice.productId }
    });
    if (product?.type !== 'credits' || !product.grant?.credits) {
      return;
    }
    await this.credits.clawbackPurchase(
      manager,
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
