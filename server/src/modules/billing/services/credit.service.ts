import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import { CreditBalance } from '../entities/credit-balance.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
import type { CreditLedgerReason } from '../entities/credit-ledger.entity';

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
    return Math.max(0, balance?.balanceUnits ?? 0);
  }

  /** Negative balance (refund of already-spent credits) blocks usage. */
  async isBlocked(customerId: string): Promise<boolean> {
    const balance = await this.getBalance(customerId);
    return (balance?.balanceUnits ?? 0) < 0;
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
        delta,
        reason,
        refInvoiceId: invoiceId
      })
    );
  }
}
