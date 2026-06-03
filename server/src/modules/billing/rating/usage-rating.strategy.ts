import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  ProrationResult,
  RatedAmount,
  RatingStrategy
} from './rating-strategy.interface';

/**
 * Pay-as-you-go rating: aggregate metered usage over the period and apply the
 * plan's included units + unit price. Implemented in M2.
 */
@Injectable()
export class UsageRating implements RatingStrategy {
  readonly mode = 'usage' as const;

  amountForPeriod(): RatedAmount {
    throw new NotImplementedException('Usage rating (M2)');
  }

  prorate(): ProrationResult {
    throw new NotImplementedException('Usage rating (M2)');
  }
}
