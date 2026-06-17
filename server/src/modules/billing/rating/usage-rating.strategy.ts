import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { UsageRecord } from '../entities/usage-record.entity';
import type { Plan } from '../entities/plan.entity';
import type { Subscription } from '../entities/subscription.entity';
import type {
  BillingPeriod,
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
 * A period rated with prepaid credits applied first: only `chargedUnits` (the
 * overage left after `creditUnitsApplied`) cost money.
 */
export interface CreditedUsageSummary extends UsagePeriodSummary {
  creditUnitsApplied: number;
  chargedUnits: number;
}

/**
 * Pay-as-you-go rating: sum the subscription's `UsageRecord`s whose
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

  /**
   * Rates a period with the customer's prepaid credits spent before money is
   * charged: credits offset billable units one-for-one, and only the
   * remainder is priced. Pure with respect to the balance — the caller reads
   * the available units and deducts `creditUnitsApplied` itself, gated on its
   * idempotent invoice insert.
   */
  async summarizeForPeriodWithCredits(
    subscription: Subscription,
    plan: Plan,
    period: BillingPeriod,
    availableCreditUnits: number
  ): Promise<CreditedUsageSummary> {
    const base = await this.summarizeForPeriod(subscription, plan, period);
    const creditUnitsApplied = Math.min(
      Math.max(0, availableCreditUnits),
      base.billableUnits
    );
    const chargedUnits = base.billableUnits - creditUnitsApplied;
    const amountMinor = Money.fromMinor(base.unitPriceMinor)
      .mulInt(chargedUnits)
      .toNumber();
    return {
      ...base,
      creditUnitsApplied,
      chargedUnits,
      amountMinor,
      receiptItems:
        amountMinor > 0
          ? [
              {
                description: `${plan.name}: ${plan.meterKey ?? 'usage'} × ${chargedUnits}`,
                amountMinor,
                quantity: 1
              }
            ]
          : []
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

    // SUM over a bigint column comes back as a numeric string; decode it through
    // Money so an overflow throws loudly rather than silently losing precision
    // (the start is inclusive, the end exclusive — a record stamped exactly at
    // the boundary belongs to the next period).
    const raw = await this.usageRecords
      .createQueryBuilder('u')
      .select('COALESCE(SUM(u.quantity), 0)', 'total')
      .where('u.subscriptionId = :subscriptionId', {
        subscriptionId: subscription.id
      })
      .andWhere('u.occurredAt >= :start', { start: period.start })
      .andWhere('u.occurredAt < :end', { end: period.end })
      .getRawOne<{ total: string }>();
    const totalUnits = Money.fromMinor(BigInt(raw?.total ?? '0')).toNumber();

    const includedUnits = price.includedUnits ?? 0;
    const unitPriceMinor = price.unitPriceMinor ?? 0;
    const billableUnits = Math.max(0, totalUnits - includedUnits);
    const amountMinor = Money.fromMinor(unitPriceMinor)
      .mulInt(billableUnits)
      .toNumber();

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
}
