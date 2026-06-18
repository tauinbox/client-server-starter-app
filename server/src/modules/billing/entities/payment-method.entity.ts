import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Exclude } from 'class-transformer';
import type { BillingProviderId } from '@app/shared/types';

@Entity('billing_payment_methods')
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: BillingProviderId;

  @Column({ name: 'provider_method_ref', type: 'varchar' })
  @Exclude()
  providerMethodRef: string;

  @Column({ type: 'varchar', length: 32 })
  brand: string;

  @Column({ type: 'varchar', length: 4 })
  last4: string;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
