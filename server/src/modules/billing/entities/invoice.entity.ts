import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Money } from '@app/shared/utils/money';
import type {
  BillingMode,
  BillingProviderId,
  InvoiceKind,
  InvoiceStatus
} from '@app/shared/types';
import {
  MoneyToNumber,
  moneyColumnTransformer
} from '../../../common/utils/money-column.transformer';

@Entity('billing_invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @Column({ type: 'varchar', length: 32 })
  provider: BillingProviderId;

  @Column({
    name: 'provider_event_id',
    type: 'varchar',
    nullable: true,
    unique: true
  })
  @Exclude()
  providerEventId: string | null;

  @Column({ name: 'provider_invoice_ref', type: 'varchar' })
  providerInvoiceRef: string;

  @Column({
    name: 'amount_minor',
    type: 'bigint',
    transformer: moneyColumnTransformer
  })
  @MoneyToNumber()
  amountMinor: Money;

  @Column({
    name: 'refunded_minor',
    type: 'bigint',
    default: 0,
    transformer: moneyColumnTransformer
  })
  @Exclude()
  refundedMinor: Money;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 16 })
  status: InvoiceStatus;

  @Column({ name: 'billing_mode', type: 'varchar', length: 16 })
  billingMode: BillingMode;

  @Column({ type: 'varchar', length: 16, default: 'subscription' })
  kind: InvoiceKind;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'receipt_ref', type: 'varchar', nullable: true })
  receiptRef: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
