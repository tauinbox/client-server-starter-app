import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { CreditBalance } from '../entities/credit-balance.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
import type { CreditLedgerReason } from '../entities/credit-ledger.entity';

const ZERO = Money.fromMinor(0);

/**
 * Single owner of the prepaid credit balance. Every change is an atomic SQL
 * upsert (`balance += delta`, never read-modify-write) paired with an
 * append-only `CreditLedger` entry, both on the caller's `EntityManager` so
 * they commit or roll back with the invoice work that caused them. Exactly-once
 * application is the caller's concern — purchases and usage spend run only
 * after the caller won its unique `provider_event_id` invoice insert; the
 * refund clawback is gated by the invoice's one-way `paid → refunded` flip.
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

  /** Units usage rating may spend — a clawed-back negative balance offers none. */
  async availableUnits(customerId: string): Promise<number> {
    const balance = await this.getBalance(customerId);
    return positiveUnits(balance);
  }

  /**
   * Reads available units while holding a `FOR UPDATE` lock on the balance row
   * on the caller's transactional `EntityManager`. Concurrent usage spenders
   * for the same customer serialize on the lock: the second waits, then reads
   * the balance the first already decremented, so credits cannot be applied
   * twice off one stale read. A customer with no balance row has nothing to
   * lock and nothing to spend (0 units) - the race is irrelevant there.
   */
  async availableUnitsForUpdate(
    manager: EntityManager,
    customerId: string
  ): Promise<number> {
    const balance = await manager.findOne(CreditBalance, {
      where: { customerId },
      lock: { mode: 'pessimistic_write' }
    });
    return positiveUnits(balance);
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

  /** Usage rating spends prepaid units before money is charged. */
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
