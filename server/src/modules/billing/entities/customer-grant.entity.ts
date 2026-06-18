import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn
} from 'typeorm';

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
  customerId: string;

  @Column()
  entitlement: string;

  @Column({ name: 'source_invoice_id', type: 'uuid' })
  sourceInvoiceId: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
