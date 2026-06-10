import type { BillingMode } from '@app/shared/types';
import type { Plan } from '../entities/plan.entity';
import type { Subscription } from '../entities/subscription.entity';
import type { ReceiptItem } from '../providers/payment-provider.interface';

export interface BillingPeriod {
  start: Date;
  end: Date;
}

export interface RatedAmount {
  amountMinor: number;
  receiptItems: ReceiptItem[];
}

/**
 * How a subscription's charge for a period is computed (Axis B). `FixedRating`
 * reads the plan's per-provider price synchronously; `UsageRating` aggregates
 * `UsageRecord`s from the database, so the contract admits both shapes.
 * Plan-change proration is not a rating concern: Paddle delegates it and
 * YooKassa uses the dedicated `ProrationCalculator`.
 */
export interface RatingStrategy {
  readonly mode: BillingMode;
  amountForPeriod(
    subscription: Subscription,
    plan: Plan,
    period: BillingPeriod
  ): RatedAmount | Promise<RatedAmount>;
}
