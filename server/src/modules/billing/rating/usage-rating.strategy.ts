import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { UsageRecord } from '../entities/usage-record.entity';
import type { Plan } from '../entities/plan.entity';
import type { Subscription } from '../entities/subscription.entity';
import type {
  BillingPeriod,
  ProrationResult,
  RatedAmount,
  RatingStrategy
} from './rating-strategy.interface';

/** A period's metered usage rated against the plan's per-provider price. */
export interface UsagePeriodSummary extends RatedAmount {
  totalUnits: number;
  includedUnits: number;
  billableUnits: number;
  unitPriceMinor: number;
  currency: string;
}

/**
 * Pay-as-you-go rating (design §5): sum the subscription's `UsageRecord`s whose
 * `occurredAt` falls inside the period (start inclusive, end exclusive — a
 * record stamped exactly at the boundary belongs to the next period), subtract
 * the plan's included units, and charge the overage at the unit price. Pure
 * usage only — hybrid "base fee + overage" is out of v1, so the price's
 * `amountMinor` is not added.
 */
@Injectable()
export class UsageRating implements RatingStrategy {
  readonly mode = 'usage' as const;

  constructor(
    @InjectRepository(UsageRecord)
    private readonly usageRecords: Repository<UsageRecord>
  ) {}

  async amountForPeriod(
    subscription: Subscription,
    plan: Plan,
    period: BillingPeriod
  ): Promise<RatedAmount> {
    const summary = await this.summarizeForPeriod(subscription, plan, period);
    return {
      amountMinor: summary.amountMinor,
      receiptItems: summary.receiptItems
    };
  }

  async summarizeForPeriod(
    subscription: Subscription,
    plan: Plan,
    period: BillingPeriod
  ): Promise<UsagePeriodSummary> {
    const price = plan.prices[subscription.provider];
    if (!price) {
      throw new Error(
        `Plan "${plan.key}" has no price for provider "${subscription.provider}"`
      );
    }

    const totalUnits =
      (await this.usageRecords.sum('quantity', {
        subscriptionId: subscription.id,
        occurredAt: And(MoreThanOrEqual(period.start), LessThan(period.end))
      })) ?? 0;

    const includedUnits = price.includedUnits ?? 0;
    const unitPriceMinor = price.unitPriceMinor ?? 0;
    const billableUnits = Math.max(0, totalUnits - includedUnits);
    const amountMinor = billableUnits * unitPriceMinor;

    return {
      totalUnits,
      includedUnits,
      billableUnits,
      unitPriceMinor,
      currency: price.currency,
      amountMinor,
      receiptItems:
        amountMinor > 0
          ? [
              {
                description: `${plan.name}: ${plan.meterKey ?? 'usage'} × ${billableUnits}`,
                amountMinor,
                quantity: 1
              }
            ]
          : []
    };
  }

  prorate(): ProrationResult {
    throw new NotImplementedException('Usage-plan proration (M3)');
  }
}
