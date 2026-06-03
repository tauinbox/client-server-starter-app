import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import type {
  BillingMode,
  BillingProviderId,
  PlanInterval,
  PlanPrice
} from '@app/shared/types';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ name: 'billing_mode', type: 'varchar', length: 16 })
  billingMode: BillingMode;

  @Column({ type: 'varchar', length: 16 })
  interval: PlanInterval;

  @Column({ name: 'meter_key', type: 'varchar', nullable: true })
  meterKey: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  entitlements: string[];

  @Column({ type: 'jsonb', nullable: true })
  limits: Record<string, number> | null;

  @Column({ name: 'trial_days', type: 'integer', default: 0 })
  trialDays: number;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'jsonb' })
  prices: Partial<Record<BillingProviderId, PlanPrice>>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
