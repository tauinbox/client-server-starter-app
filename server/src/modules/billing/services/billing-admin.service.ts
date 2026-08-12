import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import type { PaginationQueryDto } from '../../../common/dtos/pagination-query.dto';
import { PaginatedResponseDto } from '../../../common/dtos/paginated-response.dto';
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
import { cancelFields } from '../utils/cancel-fields.util';
import {
  invoiceOrder,
  sortDirection,
  subscriptionOrder
} from '../utils/list-order.util';
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
  private readonly logger = new Logger(BillingAdminService.name);

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

  async listSubscriptions(
    query: PaginationQueryDto
  ): Promise<PaginatedResponseDto<Subscription>> {
    const { page, limit, sortBy, sortOrder } = query;
    const [data, total] = await this.subscriptions.findAndCount({
      order: subscriptionOrder(sortBy, sortDirection(sortOrder)),
      skip: (page - 1) * limit,
      take: limit
    });
    return new PaginatedResponseDto(data, total, page, limit);
  }

  async listInvoices(
    query: PaginationQueryDto
  ): Promise<PaginatedResponseDto<Invoice>> {
    const { page, limit, sortBy, sortOrder } = query;
    const [data, total] = await this.invoices.findAndCount({
      order: invoiceOrder(sortBy, sortDirection(sortOrder)),
      skip: (page - 1) * limit,
      take: limit
    });
    return new PaginatedResponseDto(data, total, page, limit);
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

    const fields = cancelFields(mode);
    Object.assign(subscription, fields);
    await this.subscriptions.update({ id: subscription.id }, fields);
    const saved =
      (await this.subscriptions.findOne({ where: { id } })) ?? subscription;

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

  /**
   * Refunds a leg of an invoice through its provider, in three steps: reserve,
   * call, settle.
   *
   * The row lock cannot be held across the provider call - an HTTP round-trip
   * inside an open transaction pins a pool connection for its whole duration -
   * so the leg first commits its amount onto `refundedMinor`. That reservation
   * is what makes concurrency safe: a second leg prices against the reserved
   * total and fails its own remaining-amount check before any funds move.
   * Reserving amounts that never move is the deliberate failure direction; the
   * compensating release gives them back.
   *
   * Known gap, left as an operator task rather than papered over: a crash
   * between a successful provider call and the settling transaction leaves the
   * invoice `paid` with `refunded_minor` at the full amount, so the grant
   * revoke never runs and a retry is refused (nothing left to refund). That
   * pair of values is the signature to reconcile on.
   */
  async refundInvoice(id: string, amountMinor?: number): Promise<Invoice> {
    const { refundAmount, cumulativeRefunded, providerRef } =
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

        const remaining = invoice.amountMinor.sub(invoice.refundedMinor);
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

        const cumulativeRefunded = invoice.refundedMinor.add(refundAmount);
        invoice.refundedMinor = cumulativeRefunded;
        await manager.save(Invoice, invoice);

        return {
          refundAmount,
          cumulativeRefunded,
          providerRef: {
            provider: invoice.provider,
            invoiceRef: invoice.providerInvoiceRef
          }
        };
      });

    const provider = this.billing.getProviderById(providerRef.provider);
    if (provider) {
      try {
        // Keying on the cumulative-after total makes a post-crash retry reuse
        // the same key and dedup at the provider.
        await provider.refund(
          providerRef.invoiceRef,
          refundAmount.toNumber(),
          `refund-${id}-${cumulativeRefunded.toMinorString()}`
        );
      } catch (error) {
        await this.releaseReservation(id, refundAmount);
        throw error;
      }
    }

    // The money side is already recorded, so settling is only the status flip.
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

        // The one-way `paid -> refunded` flip keeps grant revoke / credit
        // clawback exactly-once. Gating it on this leg's own cumulative rather
        // than on the row keeps a concurrent leg's still-in-flight reservation
        // from revoking access for money that may never move.
        if (
          cumulativeRefunded.compare(invoice.amountMinor) < 0 ||
          invoice.status !== 'paid'
        ) {
          return { saved: invoice, invalidateUserId: null };
        }
        invoice.status = 'refunded';
        const invalidateUserId = await this.revokeOneTimeGrants(
          manager,
          invoice
        );
        await this.clawbackCreditPurchase(manager, invoice);
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
   * Gives back a reservation whose provider call failed. `refundedMinor` is
   * only ever moved by a reservation (up) or this release (down), so
   * subtracting this leg's own amount under the lock cannot disturb a
   * concurrent one. A refund that reached the provider despite the error is not
   * lost: the retry prices from the released total, so it recomputes the same
   * idempotency key and the providers' key scans collapse it into the original
   * money move. A release that itself fails leaves the reservation standing -
   * the invoice then shows more refunded than was paid out until an operator
   * reconciles it, which is the safe direction to fail in.
   */
  private async releaseReservation(
    id: string,
    refundAmount: Money
  ): Promise<void> {
    try {
      await withTransaction(this.dataSource, async (manager) => {
        const invoice = await manager.findOne(Invoice, {
          where: { id },
          lock: { mode: 'pessimistic_write' }
        });
        if (!invoice) {
          return;
        }
        const released = invoice.refundedMinor.sub(refundAmount);
        invoice.refundedMinor = released.compare(ZERO) < 0 ? ZERO : released;
        await manager.save(Invoice, invoice);
        if (invoice.status === 'refunded') {
          this.logger.error(
            `Invoice ${id} is marked refunded but a leg of ${refundAmount.toMinorString()} was released; reconcile against the provider`
          );
        }
      });
    } catch (error) {
      this.logger.error(
        `Failed to release refund reservation of ${refundAmount.toMinorString()} on invoice ${id}: ${(error as Error).message}`
      );
    }
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
