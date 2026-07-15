import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Money } from '@app/shared/utils/money';
import { Customer } from './customer.entity';
import { Subscription } from './subscription.entity';
import { Product } from './product.entity';
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
@Unique('UQ_billing_invoices_provider_event_id', ['providerEventId'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  // RESTRICT: invoices are financial records and must survive any future
  // hard-delete of a customer; erasure requires an explicit archival step
  @ForeignKey<Customer>(() => Customer, {
    onDelete: 'RESTRICT',
    name: 'FK_billing_invoices_customer_id'
  })
  customerId: string;

  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  @ForeignKey<Subscription>(() => Subscription, {
    onDelete: 'SET NULL',
    name: 'FK_billing_invoices_subscription_id'
  })
  subscriptionId: string | null;

  @Column({ type: 'varchar', length: 32 })
  provider: BillingProviderId;

  @Column({
    name: 'provider_event_id',
    type: 'varchar',
    length: 255,
    nullable: true
  })
  @Exclude()
  providerEventId: string | null;

  @Column({ name: 'provider_invoice_ref', type: 'varchar', length: 255 })
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

  // Prepaid credit units this invoice's amount was rated against. Persisted on
  // a pending (uncaptured) charge so the later settle spends exactly the units
  // the charged amount assumed, even if the live balance drifted meanwhile.
  @Column({ name: 'credit_units_applied', type: 'int', default: 0 })
  @Exclude()
  creditUnitsApplied: number;

  @Column({ name: 'billing_mode', type: 'varchar', length: 16 })
  billingMode: BillingMode;

  @Column({ type: 'varchar', length: 16, default: 'subscription' })
  kind: InvoiceKind;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  @ForeignKey<Product>(() => Product, {
    onDelete: 'SET NULL',
    name: 'FK_billing_invoices_product_id'
  })
  productId: string | null;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'receipt_ref', type: 'varchar', length: 255, nullable: true })
  receiptRef: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
