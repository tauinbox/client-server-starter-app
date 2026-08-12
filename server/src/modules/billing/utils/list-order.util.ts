/**
 * Keyset sort maps for the billing list endpoints: query-string `sortBy` ->
 * qualified column. The map doubles as the whitelist the keyset helper falls
 * back through, and the DTOs (`billing-cursor-query.dto.ts`) reject anything
 * outside it before the query is built.
 */
export const INVOICE_SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: 'invoice.createdAt',
  status: 'invoice.status'
};

export const SUBSCRIPTION_SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: 'subscription.createdAt',
  currentPeriodEnd: 'subscription.currentPeriodEnd',
  status: 'subscription.status'
};
