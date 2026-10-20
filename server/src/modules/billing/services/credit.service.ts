import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository, type EntityManager } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { CreditBalance } from '../entities/credit-balance.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
import type { CreditLedgerReason } from '../entities/credit-ledger.entity';
import { Invoice, UNPAID_INVOICE_STATUSES } from '../entities/invoice.entity';

const ZERO = Money.fromMinor(0);

/**
 * Single owner of the prepaid credit balance. Every change is an atomic SQL
 * upsert (`balance += delta`, never read-modify-write) paired with an
 * append-only `CreditLedger` entry, both on the caller's `EntityManager` so
 * they commit or roll back with the invoice work that caused them. Exactly-once
 * application is the caller's concern — a purchase runs only after the caller
 * won its unique `provider_event_id` invoice insert, a usage spend only on the
 * winning flip of its invoice to `paid`, and the refund clawback is gated by
 * the invoice's one-way `paid → refunded` flip.
 */
@Injectable()
export class CreditService {
  constructor(
    @InjectRepository(CreditBalance)
    private readonly balances: Repository<CreditBalance>
  ) {}

  getBalance(customerId: string): Promise<CreditBalance | null> {
    return this.balances.findOne({ where: { customerId } });
  }

  /**
   * The units a usage rating may apply: the balance minus the units that the
   * customer's unpaid invoices still hold. Credits are spent only when an
   * invoice becomes `paid`, so an open charge holds its `creditUnitsApplied`
   * until its outcome is final. The balance row is read `FOR UPDATE` on the
   * caller's transaction, and the caller writes its own invoice in that
   * transaction: two ratings of one customer serialize on the lock, and the
   * second sees the hold of the first. `excludeInvoiceId` keeps the row that a
   * retry re-rates out of its own hold. A customer with no balance row has
   * nothing to lock and nothing to apply.
   */
  async availableUnitsForUpdate(
    manager: EntityManager,
    customerId: string,
    excludeInvoiceId?: string
  ): Promise<number> {
    const balance = await manager.findOne(CreditBalance, {
      where: { customerId },
      lock: { mode: 'pessimistic_write' }
    });
    const units = positiveUnits(balance);
    if (units === 0) {
      return 0;
    }
    const query = manager
      .createQueryBuilder(Invoice, 'i')
      .select('COALESCE(SUM(i.creditUnitsApplied), 0)', 'held')
      .where('i.customerId = :customerId', { customerId })
      .andWhere('i.status IN (:...statuses)', {
        statuses: [...UNPAID_INVOICE_STATUSES]
      })
      .andWhere('i.creditsReleasedAt IS NULL');
    if (excludeInvoiceId) {
      query.andWhere('i.id <> :excludeInvoiceId', { excludeInvoiceId });
    }
    const held = await query.getRawOne<{ held: string }>();
    return Math.max(0, units - Number(held?.held ?? 0));
  }

  /**
   * Ends the hold of unpaid invoices whose outcome is final: a declined
   * charge (`providerEventId`), or every unpaid invoice of a subscription that
   * ran out of dunning or closed (`subscriptionId`). Runs on the caller's
   * transaction, together with the state change that makes the outcome final.
   */
  async releaseHolds(
    manager: EntityManager,
    where: { providerEventId: string } | { subscriptionId: string }
  ): Promise<void> {
    await manager.update(
      Invoice,
      {
        ...where,
        status: In([...UNPAID_INVOICE_STATUSES]),
        creditsReleasedAt: IsNull()
      },
      { creditsReleasedAt: () => 'now()' }
    );
  }

  /** Negative balance (refund of already-spent credits) blocks usage. */
  async isBlocked(customerId: string): Promise<boolean> {
    const balance = await this.getBalance(customerId);
    return balance != null && balance.balanceUnits.compare(ZERO) < 0;
  }

  /** A paid credit-pack purchase tops the balance up. */
  addPurchase(
    manager: EntityManager,
    customerId: string,
    invoiceId: string,
    credits: number
  ): Promise<void> {
    return this.applyDelta(manager, customerId, invoiceId, credits, 'purchase');
  }

  /** A paid usage invoice spends the units its amount was rated against. */
  spendOnUsage(
    manager: EntityManager,
    customerId: string,
    invoiceId: string,
    units: number
  ): Promise<void> {
    return this.applyDelta(manager, customerId, invoiceId, -units, 'usage');
  }

  /**
   * A full refund of a credit-pack purchase takes the granted units back.
   * Runs on the caller's `EntityManager` so the deduction commits or rolls back
   * atomically with the invoice's `paid → refunded` flip that triggered it.
   * Already-spent credits drive the balance negative — usage stays blocked
   * until it is topped up; the debt is never written off automatically.
   */
  clawbackPurchase(
    manager: EntityManager,
    customerId: string,
    invoiceId: string,
    credits: number
  ): Promise<void> {
    return this.applyDelta(manager, customerId, invoiceId, -credits, 'refund');
  }

  private async applyDelta(
    manager: EntityManager,
    customerId: string,
    invoiceId: string,
    delta: number,
    reason: CreditLedgerReason
  ): Promise<void> {
    await manager.query(
      `INSERT INTO billing_credit_balances ("customer_id", "balance_units")
       VALUES ($1, $2)
       ON CONFLICT ("customer_id") DO UPDATE
       SET "balance_units" = billing_credit_balances."balance_units" + EXCLUDED."balance_units",
           "updated_at" = now()`,
      [customerId, delta]
    );
    await manager.save(
      manager.create(CreditLedger, {
        customerId,
        delta: Money.fromMinor(delta),
        reason,
        refInvoiceId: invoiceId
      })
    );
  }
}

/** Spendable units: a positive balance's count, zero for none / a clawed-back debt. */
function positiveUnits(balance: CreditBalance | null): number {
  const units = balance?.balanceUnits;
  return units && units.compare(ZERO) > 0 ? units.toNumber() : 0;
}
