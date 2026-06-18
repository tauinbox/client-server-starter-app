import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Exclude } from 'class-transformer';
import type { BillingProviderId } from '@app/shared/types';
import { User } from '../../users/entities/user.entity';
import { PaymentMethod } from './payment-method.entity';

@Entity('billing_customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  @ForeignKey<User>(() => User, {
    onDelete: 'CASCADE',
    name: 'FK_billing_customers_user_id'
  })
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

  @Column({
    name: 'provider_customer_id',
    type: 'varchar',
    length: 255,
    nullable: true
  })
  @Exclude()
  providerCustomerId: string | null;

  @Column({ type: 'varchar', length: 2 })
  country: string;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ name: 'default_payment_method_id', type: 'uuid', nullable: true })
  @ForeignKey<PaymentMethod>(() => PaymentMethod, {
    onDelete: 'SET NULL',
    name: 'FK_billing_customers_default_payment_method_id'
  })
  defaultPaymentMethodId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
