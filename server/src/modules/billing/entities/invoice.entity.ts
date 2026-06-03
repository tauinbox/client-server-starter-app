import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Exclude } from 'class-transformer';
import type {
  BillingMode,
  BillingProviderId,
  InvoiceStatus
} from '@app/shared/types';

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

  @Column({ name: 'amount_minor', type: 'integer' })
  amountMinor: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 16 })
  status: InvoiceStatus;

  @Column({ name: 'billing_mode', type: 'varchar', length: 16 })
  billingMode: BillingMode;

  @Column({ name: 'period_start', type: 'timestamp' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamp' })
  periodEnd: Date;

  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'receipt_ref', type: 'varchar', nullable: true })
  receiptRef: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
