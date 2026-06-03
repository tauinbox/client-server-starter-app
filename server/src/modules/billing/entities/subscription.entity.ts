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
  SubscriptionStatus
} from '@app/shared/types';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'plan_key', type: 'varchar' })
  planKey: string;

  @Column({ type: 'varchar', length: 32 })
  provider: BillingProviderId;

  @Column({ name: 'billing_mode', type: 'varchar', length: 16 })
  billingMode: BillingMode;

  @Column({ type: 'varchar', length: 32 })
  status: SubscriptionStatus;

  @Column({ name: 'lifecycle_owner', type: 'varchar', length: 16 })
  lifecycleOwner: 'provider' | 'self';

  @Column({ name: 'current_period_start', type: 'timestamp' })
  currentPeriodStart: Date;

  @Column({ name: 'current_period_end', type: 'timestamp' })
  currentPeriodEnd: Date;

  @Column({ name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'trial_end', type: 'timestamp', nullable: true })
  trialEnd: Date | null;

  @Column({ name: 'provider_subscription_id', type: 'varchar', nullable: true })
  @Exclude()
  providerSubscriptionId: string | null;

  @Column({ name: 'payment_method_id', type: 'uuid', nullable: true })
  paymentMethodId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
