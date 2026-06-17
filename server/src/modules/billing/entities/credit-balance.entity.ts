import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import {
  MoneyToNumber,
  moneyColumnTransformer
} from '../../../common/utils/money-column.transformer';

/**
 * The customer's prepaid credit balance. Topped up by paid `credits`
 * purchases, spent by metered usage before money is charged. A refund of
 * already-spent credits may drive it negative — usage recording is blocked
 * until the balance is topped up back above zero. All deltas are applied
 * atomically by CreditService and journaled in CreditLedger.
 */
@Entity('billing_credit_balances')
export class CreditBalance {
  @PrimaryColumn('uuid', { name: 'customer_id' })
  customerId: string;

  @Column({
    name: 'balance_units',
    type: 'bigint',
    default: 0,
    transformer: moneyColumnTransformer
  })
  @MoneyToNumber()
  balanceUnits: Money;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
