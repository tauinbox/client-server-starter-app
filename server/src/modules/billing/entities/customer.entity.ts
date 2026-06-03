import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Exclude } from 'class-transformer';
import type { BillingProviderId } from '@app/shared/types';

@Entity('billing_customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: BillingProviderId;

  @Column({
    name: 'provider_override',
    type: 'varchar',
    length: 32,
    nullable: true
  })
  providerOverride: BillingProviderId | null;

  @Column({ name: 'provider_customer_id', type: 'varchar', nullable: true })
  @Exclude()
  providerCustomerId: string | null;

  @Column({ type: 'varchar', length: 2 })
  country: string;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ name: 'default_payment_method_id', type: 'uuid', nullable: true })
  defaultPaymentMethodId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
