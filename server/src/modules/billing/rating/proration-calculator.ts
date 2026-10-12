import { Injectable } from '@nestjs/common';
import {
  prorationAmounts,
  type ProrationAmounts
} from '@app/shared/utils/billing-rules';
import type { BillingProviderId } from '@app/shared/types';
import type { Plan } from '../entities/plan.entity';
import type { ReceiptItem } from '../providers/payment-provider.interface';

export interface ProrationInput {
  fromPlan: Plan;
  toPlan: Plan;
  provider: BillingProviderId;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}

export interface ProrationQuote extends ProrationAmounts {
  refundItems: ReceiptItem[];
  chargeItems: ReceiptItem[];
}

/**
 * Self-managed (YooKassa) plan-change proration. The amounts and the rounding
 * policy are `prorationAmounts`, which the mock server runs too; this adds the
 * receipt items, because each leg is fiscalized separately (refund receipt +
 * payment receipt). Metered overage is settled by the usage-invoicing path,
 * not here.
 */
@Injectable()
export class ProrationCalculator {
  quote(input: ProrationInput): ProrationQuote {
    const { fromPlan, toPlan } = input;
    const amounts = prorationAmounts(input);
    const { remainderDays, totalDays, refundMinor, chargeMinor } = amounts;

    return {
      ...amounts,
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
}
