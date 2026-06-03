import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Plan } from '../entities/plan.entity';
import type { Subscription } from '../entities/subscription.entity';
import type {
  ProrationResult,
  RatedAmount,
  RatingStrategy
} from './rating-strategy.interface';

/**
 * Fixed-tier rating: the period charge is the plan's price for the
 * subscription's resolved provider. Proration is deferred to M3.
 */
@Injectable()
export class FixedRating implements RatingStrategy {
  readonly mode = 'fixed' as const;

  amountForPeriod(subscription: Subscription, plan: Plan): RatedAmount {
    const price = plan.prices[subscription.provider];
    if (!price) {
      throw new Error(
        `Plan "${plan.key}" has no price for provider "${subscription.provider}"`
      );
    }
    return {
      amountMinor: price.amountMinor,
      receiptItems: [
        { description: plan.name, amountMinor: price.amountMinor, quantity: 1 }
      ]
    };
  }

  prorate(): ProrationResult {
    throw new NotImplementedException('Fixed-plan proration (M3)');
  }
}
