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

  /**
   * Optimistic-concurrency token bumped by each self-service plan change so two
   * concurrent changes can't both charge: the loser's compare-and-swap misses.
   */
  @Column({ type: 'integer', default: 1 })
  @Exclude()
  version: number;

  /** Consecutive failed self-managed charges; resets to 0 on a successful one. */
  @Column({ name: 'dunning_attempts', type: 'integer', default: 0 })
  @Exclude()
  dunningAttempts: number;

  /** When the renewal scheduler next retries a `past_due` self-managed charge. */
  @Column({
    name: 'next_renewal_attempt_at',
    type: 'timestamp',
    nullable: true
  })
  @Exclude()
  nextRenewalAttemptAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
