import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import type {
  BillingMode,
  BillingProviderId,
  PlanInterval,
  PlanPrice
} from '@app/shared/types';

@Entity('plans')
@Unique('UQ_plans_key', ['key'])
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  key: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ name: 'billing_mode', type: 'varchar', length: 16 })
  billingMode: BillingMode;

  @Column({ type: 'varchar', length: 16 })
  interval: PlanInterval;

  @Column({ name: 'meter_key', type: 'varchar', length: 100, nullable: true })
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
