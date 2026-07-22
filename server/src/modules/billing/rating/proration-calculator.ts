import { Injectable } from '@nestjs/common';
import { Money } from '@app/shared/utils/money';
import type { BillingProviderId } from '@app/shared/types';
import type { Plan } from '../entities/plan.entity';
import type { ReceiptItem } from '../providers/payment-provider.interface';

const DAY_MS = 86_400_000;

export interface ProrationInput {
  fromPlan: Plan;
  toPlan: Plan;
  provider: BillingProviderId;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}

export interface ProrationQuote {
  /** Whole days left in the current period (a started day counts as remaining). */
  remainderDays: number;
  totalDays: number;
  currency: string;
  /** Unused remainder of the old plan's fixed price, to refund. */
  refundMinor: number;
  /** The new plan's fixed price prorated over the remainder, to charge. */
  chargeMinor: number;
  refundItems: ReceiptItem[];
  chargeItems: ReceiptItem[];
}

/**
 * Self-managed (YooKassa) plan-change proration: immediate
 * switch, refund-and-recharge, whole-day granularity, no credit carry-forward.
 * Both legs use the same remainder so the split stays internally consistent;
 * each leg is fiscalized separately (refund receipt + payment receipt). Usage
 * plans have a zero fixed price, so a leg on a usage plan contributes nothing —
 * metered overage is settled by the usage-invoicing path, not here.
 *
 * Rounding policy (deliberate, applies to both legs symmetrically): each leg is
 * floored to whole minor units, so the sub-minor-unit remainder of each leg
 * stays with the merchant. Flooring the refund alone would favour the merchant
 * twice; rounding the refund up instead would let a repeated upgrade/downgrade
 * cycle skim a minor unit per switch. Flooring both caps the buyer's worst-case
 * loss at one minor unit per leg and keeps the arithmetic exact integer math.
 * Day counting is intentionally generous the other way: a started day counts as
 * remaining (`ceil`), so the buyer is refunded for the day of the switch.
 */
@Injectable()
export class ProrationCalculator {
  quote(input: ProrationInput): ProrationQuote {
    const { fromPlan, toPlan, provider, periodStart, periodEnd, now } = input;
    const fromPrice = this.priceFor(fromPlan, provider);
    const toPrice = this.priceFor(toPlan, provider);

    const totalDays = Math.max(
      1,
      Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY_MS)
    );
    const remainderDays = Math.min(
      totalDays,
      Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / DAY_MS))
    );

    const refundMinor = Money.fromMinor(fromPrice)
      .mulInt(remainderDays)
      .divFloor(totalDays)
      .toNumber();
    const chargeMinor = Money.fromMinor(toPrice)
      .mulInt(remainderDays)
      .divFloor(totalDays)
      .toNumber();

    const currency =
      toPlan.prices[provider]?.currency ??
      fromPlan.prices[provider]?.currency ??
      'USD';

    return {
      remainderDays,
      totalDays,
      currency,
      refundMinor,
      chargeMinor,
      refundItems:
        refundMinor > 0
          ? [
              {
                description: `${fromPlan.name}: unused remainder (${remainderDays} of ${totalDays} days)`,
                amountMinor: refundMinor,
                quantity: 1
              }
            ]
          : [],
      chargeItems:
        chargeMinor > 0
          ? [
              {
                description: `${toPlan.name}: prorated (${remainderDays} of ${totalDays} days)`,
                amountMinor: chargeMinor,
                quantity: 1
              }
            ]
          : []
    };
  }

  private priceFor(plan: Plan, provider: BillingProviderId): number {
    return plan.prices[provider]?.amountMinor ?? 0;
  }
}
