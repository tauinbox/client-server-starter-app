/**
 * The single owner of `refundedMinor`'s invariant `0 <= refundedMinor <=
 * amountMinor` and of the reserve/release pair that keeps it while a provider
 * call runs outside the row lock.
 *
 * The self-service proration leg and the admin refund both reserve their amount
 * under the lock, call the provider, and give the reservation back when that
 * call fails. What differs is policy, and that stays at the call sites: the
 * proration leg caps silently and skips the refund, the admin route rejects an
 * over-large request; each also logs its own operator-facing message. Only the
 * arithmetic and the lock live here.
 */
import type { EntityManager, FindOneOptions } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { Invoice } from '../entities/invoice.entity';

const ZERO = Money.fromMinor(0);

/** A reservation that has been committed onto the invoice. */
export interface RefundReservation {
  /** What was actually reserved, capped at the remaining refundable amount. */
  reserved: Money;
  /** `refundedMinor` after the reservation - the invoice's new cumulative total. */
  cumulative: Money;
}

/**
 * Reads an invoice under a row lock. Every writer of `refundedMinor` goes
 * through this, so a concurrent leg blocks instead of pricing against a stale
 * remainder.
 */
export async function lockInvoice(
  manager: EntityManager,
  options: FindOneOptions<Invoice>
): Promise<Invoice | null> {
  return manager.findOne(Invoice, {
    ...options,
    lock: { mode: 'pessimistic_write' }
  });
}

/** What is still refundable on the invoice: `amountMinor - refundedMinor`. */
export function remainingRefundable(invoice: Invoice): Money {
  return invoice.amountMinor.sub(invoice.refundedMinor);
}

/**
 * Reserves up to the remaining refundable amount on a locked invoice and
 * commits it, so a concurrent leg prices against the reserved total. A request
 * larger than the remainder is capped rather than rejected - a caller that owes
 * the user an error checks the remainder itself before calling. Nothing is
 * written when there is nothing left to reserve.
 */
export async function reserveRefund(
  manager: EntityManager,
  invoice: Invoice,
  requested: Money
): Promise<RefundReservation> {
  const remaining = remainingRefundable(invoice);
  const reserved = requested.compare(remaining) > 0 ? remaining : requested;
  if (reserved.compare(ZERO) <= 0) {
    return { reserved: ZERO, cumulative: invoice.refundedMinor };
  }
  invoice.refundedMinor = invoice.refundedMinor.add(reserved);
  await manager.save(Invoice, invoice);
  return { reserved, cumulative: invoice.refundedMinor };
}

/**
 * Gives a reservation back when its provider call failed. `refundedMinor` is
 * only ever moved by a reservation (up) or this release (down), so subtracting
 * this leg's own amount under the lock cannot disturb a concurrent one. The
 * clamp at zero is what keeps a release of more than was reserved from turning
 * the column negative. Returns the saved row so the caller can inspect the
 * state it released into, or `null` when the invoice is gone.
 */
export async function releaseRefund(
  manager: EntityManager,
  invoiceId: string,
  minor: Money
): Promise<Invoice | null> {
  const invoice = await lockInvoice(manager, { where: { id: invoiceId } });
  if (!invoice) return null;
  const released = invoice.refundedMinor.sub(minor);
  invoice.refundedMinor = released.compare(ZERO) < 0 ? ZERO : released;
  return manager.save(Invoice, invoice);
}
