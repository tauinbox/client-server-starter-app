import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn
} from 'typeorm';
import { Customer } from './customer.entity';
import { Invoice } from './invoice.entity';

/**
 * An entitlement unlocked by a paid one-time SKU purchase. Active while
 * neither expired nor revoked; EntitlementService unions active grants with
 * subscription entitlements. `sourceInvoiceId` ties the grant to the paid
 * Invoice for idempotent application and refund-driven revocation.
 */
@Entity('billing_customer_grants')
export class CustomerGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  @ForeignKey<Customer>(() => Customer, {
    onDelete: 'CASCADE',
    name: 'FK_billing_customer_grants_customer_id'
  })
  customerId: string;

  @Column({ length: 100 })
  entitlement: string;

  @Column({ name: 'source_invoice_id', type: 'uuid' })
  @ForeignKey<Invoice>(() => Invoice, {
    onDelete: 'CASCADE',
    name: 'FK_billing_customer_grants_source_invoice_id'
  })
  sourceInvoiceId: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
