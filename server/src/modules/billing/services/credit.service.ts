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
 * application is the caller's concern: a purchase runs only after the caller
 * won its unique `provider_event_id` invoice insert, a usage spend only on the
 * winning flip of its invoice to `paid`, a metered debit only with the insert
 * of its new usage record, and the refund clawback is gated by the invoice's
 * one-way `paid -> refunded` flip.
 */
export interface CreditInvoiceRef {
  customerId: string;
  invoiceId: string;
}

export interface CreditUsageRef {
  customerId: string;
  usageRecordId: string;
}

/** The balance before and after one delta. */
export interface BalanceChange {
  before: number;
  after: number;
}

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

  /** The units that metered uses took in `[from, to)`, from the ledger. */
  async spentOnMetering(
    customerId: string,
    { from, to }: { from: Date; to: Date }
  ): Promise<number> {
    const row = await this.balances.manager
      .createQueryBuilder(CreditLedger, 'l')
      .select('COALESCE(-SUM(l.delta), 0)', 'spent')
      .where('l.customerId = :customerId', { customerId })
      .andWhere('l.refUsageRecordId IS NOT NULL')
      .andWhere('l.createdAt >= :from AND l.createdAt < :to', { from, to })
      .getRawOne<{ spent: string }>();

    return Number(row?.spent ?? 0);
  }

  /**
   * The balance of the customer, read `FOR UPDATE` on the caller's
   * transaction: a debit that checks it and then writes the delta in the same
   * transaction cannot race another debit of the same customer. A customer
   * with no balance row has 0 units.
   */
  async lockedBalance(
    manager: EntityManager,
    customerId: string
  ): Promise<number> {
    const balance = await manager.findOne(CreditBalance, {
      where: { customerId },
      lock: { mode: 'pessimistic_write' }
    });

    return balance ? balance.balanceUnits.toNumber() : 0;
  }

  /** A paid credit-pack purchase tops the balance up. */
  addPurchase(
    manager: EntityManager,
    { customerId, invoiceId }: CreditInvoiceRef,
    credits: number
  ): Promise<BalanceChange> {
    return this.applyDelta(
      manager,
      { customerId, invoiceId },
      { delta: credits, reason: 'purchase' }
    );
  }

  /** A paid usage invoice spends the units its amount was rated against. */
  spendOnUsage(
    manager: EntityManager,
    { customerId, invoiceId }: CreditInvoiceRef,
    units: number
  ): Promise<BalanceChange> {
    return this.applyDelta(
      manager,
      { customerId, invoiceId },
      { delta: -units, reason: 'usage' }
    );
  }

  /**
   * A metered use takes its units. The caller holds the balance row lock
   * (`lockedBalance`) and has checked that the balance covers the units.
   */
  spendOnMetering(
    manager: EntityManager,
    { customerId, usageRecordId }: CreditUsageRef,
    units: number
  ): Promise<BalanceChange> {
    return this.applyDelta(
      manager,
      { customerId, usageRecordId },
      { delta: -units, reason: 'usage' }
    );
  }

  /**
   * A full refund of a credit-pack purchase takes the granted units back.
   * Runs on the caller's `EntityManager` so the deduction commits or rolls back
   * atomically with the invoice's `paid → refunded` flip that triggered it.
   * Already-spent credits drive the balance negative: a metered use is refused
   * until it is topped up; the debt is never written off automatically.
   */
  clawbackPurchase(
    manager: EntityManager,
    { customerId, invoiceId }: CreditInvoiceRef,
    credits: number
  ): Promise<BalanceChange> {
    return this.applyDelta(
      manager,
      { customerId, invoiceId },
      { delta: -credits, reason: 'refund' }
    );
  }

  private async applyDelta(
    manager: EntityManager,
    ref: CreditInvoiceRef | CreditUsageRef,
    { delta, reason }: { delta: number; reason: CreditLedgerReason }
  ): Promise<BalanceChange> {
    const { customerId } = ref;
    const [row] = await manager.query<{ balance_units: string }[]>(
      `INSERT INTO billing_credit_balances ("customer_id", "balance_units")
       VALUES ($1, $2)
       ON CONFLICT ("customer_id") DO UPDATE
       SET "balance_units" = billing_credit_balances."balance_units" + EXCLUDED."balance_units",
           "updated_at" = now()
       RETURNING "balance_units"`,
      [customerId, delta]
    );
    const after = Number(row.balance_units);

    await manager.save(
      manager.create(CreditLedger, {
        customerId,
        delta: Money.fromMinor(delta),
        reason,
        refInvoiceId: 'invoiceId' in ref ? ref.invoiceId : null,
        refUsageRecordId: 'usageRecordId' in ref ? ref.usageRecordId : null
      })
    );

    return { before: after - delta, after };
  }
}

/**
 * True when a delta moved the balance across zero, in either direction: the
 * pay-as-you-go entitlements start or stop.
 */
export function crossesZero({ before, after }: BalanceChange): boolean {
  return before > 0 !== after > 0;
}

/** Spendable units: a positive balance's count, zero for none / a clawed-back debt. */
function positiveUnits(balance: CreditBalance | null): number {
  const units = balance?.balanceUnits;

  return units && units.compare(ZERO) > 0 ? units.toNumber() : 0;
}
