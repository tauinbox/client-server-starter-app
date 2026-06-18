import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn
} from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { Customer } from './customer.entity';
import { Invoice } from './invoice.entity';
import { moneyColumnTransformer } from '../../../common/utils/money-column.transformer';

/** Why a credit delta was applied: pack purchase, usage spend, refund clawback. */
export type CreditLedgerReason = 'purchase' | 'usage' | 'refund';

/**
 * Append-only journal of every credit-balance change. `delta` is positive for
 * purchases and negative for usage spend / refund clawback;
 * `refInvoiceId` ties the entry to the invoice that caused it (the credit-pack
 * purchase, the usage invoice the spend offset, or the refunded purchase).
 */
@Entity('billing_credit_ledger')
export class CreditLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  @ForeignKey<Customer>(() => Customer, {
    onDelete: 'CASCADE',
    name: 'FK_billing_credit_ledger_customer_id'
  })
  customerId: string;

  @Column({ type: 'bigint', transformer: moneyColumnTransformer })
  delta: Money;

  @Column({ type: 'varchar', length: 16 })
  reason: CreditLedgerReason;

  @Column({ name: 'ref_invoice_id', type: 'uuid', nullable: true })
  @ForeignKey<Invoice>(() => Invoice, {
    onDelete: 'SET NULL',
    name: 'FK_billing_credit_ledger_ref_invoice_id'
  })
  refInvoiceId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
