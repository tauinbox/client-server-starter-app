import type { FindOptionsOrder } from 'typeorm';
import type { Invoice } from '../entities/invoice.entity';
import type { Subscription } from '../entities/subscription.entity';

export type SortDirection = 'ASC' | 'DESC';

export function sortDirection(sortOrder: 'asc' | 'desc'): SortDirection {
  return sortOrder === 'asc' ? 'ASC' : 'DESC';
}

/**
 * The billing list endpoints take `sortBy` from the query string, so the
 * column is resolved through an explicit whitelist instead of being
 * interpolated — an unrecognized value falls back to `createdAt`, which is the
 * ordering these lists had before they were paginated.
 */
export function invoiceOrder(
  sortBy: string,
  direction: SortDirection
): FindOptionsOrder<Invoice> {
  switch (sortBy) {
    case 'paidAt':
      return { paidAt: direction };
    case 'amountMinor':
      return { amountMinor: direction };
    case 'status':
      return { status: direction };
    default:
      return { createdAt: direction };
  }
}

export function subscriptionOrder(
  sortBy: string,
  direction: SortDirection
): FindOptionsOrder<Subscription> {
  switch (sortBy) {
    case 'currentPeriodEnd':
      return { currentPeriodEnd: direction };
    case 'status':
      return { status: direction };
    default:
      return { createdAt: direction };
  }
}
