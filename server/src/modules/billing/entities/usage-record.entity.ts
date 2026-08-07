import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Money } from '@app/shared/utils/money';
import { Customer } from './customer.entity';
import { Subscription } from './subscription.entity';
import {
  MoneyToNumber,
  moneyColumnTransformer
} from '../../../common/utils/money-column.transformer';

@Entity('billing_usage_records')
@Unique('UQ_billing_usage_records_customer_idempotency_key', [
  'customerId',
  'idempotencyKey'
])
export class UsageRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  @ForeignKey<Customer>(() => Customer, {
    onDelete: 'CASCADE',
    name: 'FK_billing_usage_records_customer_id'
  })
  customerId: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  @ForeignKey<Subscription>(() => Subscription, {
    onDelete: 'CASCADE',
    name: 'FK_billing_usage_records_subscription_id'
  })
  subscriptionId: string;

  @Column({ name: 'meter_key', type: 'varchar', length: 100 })
  meterKey: string;

  @Column({ type: 'bigint', transformer: moneyColumnTransformer })
  @MoneyToNumber()
  quantity: Money;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  @Exclude()
  idempotencyKey: string;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;

  /**
   * Not a column: `UsageService` stamps it on every record it hands back, since
   * whether a meter is priced depends on the plan in force rather than on
   * anything stored here. Undecorated, so TypeORM neither persists nor hydrates
   * it - a record read by any other path carries `undefined`.
   */
  pricedByCurrentPlan: boolean;
}
