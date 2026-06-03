import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn
} from 'typeorm';
import { Exclude } from 'class-transformer';

@Entity('billing_usage_records')
export class UsageRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  @Column({ name: 'meter_key', type: 'varchar' })
  meterKey: string;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'occurred_at', type: 'timestamp' })
  occurredAt: Date;

  @Column({ name: 'idempotency_key', type: 'varchar', unique: true })
  @Exclude()
  idempotencyKey: string;

  @CreateDateColumn({ name: 'recorded_at' })
  recordedAt: Date;
}
