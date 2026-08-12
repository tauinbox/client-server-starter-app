/**
 * Sortable columns of every cursor-paginated list endpoint, shared so the
 * server DTO, the mock and the client agree on one whitelist.
 *
 * Keyset pagination compares `(sortColumn, id)` tuples, and a NULL on either
 * side of that comparison silently drops rows, so **only NOT NULL columns may
 * be listed here**. Check the entity before adding one.
 */
export const ALLOWED_INVOICE_SORT_COLUMNS = ['createdAt', 'status'] as const;

export const ALLOWED_SUBSCRIPTION_SORT_COLUMNS = [
  'createdAt',
  'currentPeriodEnd',
  'status'
] as const;

export const ALLOWED_ROLE_SORT_COLUMNS = ['createdAt', 'name'] as const;

export const ALLOWED_RESOURCE_SORT_COLUMNS = ['createdAt', 'name'] as const;

export const ALLOWED_ACTION_SORT_COLUMNS = ['createdAt', 'name'] as const;

export const ALLOWED_FEATURE_FLAG_SORT_COLUMNS = ['createdAt', 'key'] as const;

export type InvoiceSortColumn = (typeof ALLOWED_INVOICE_SORT_COLUMNS)[number];
export type SubscriptionSortColumn =
  (typeof ALLOWED_SUBSCRIPTION_SORT_COLUMNS)[number];
export type RoleSortColumn = (typeof ALLOWED_ROLE_SORT_COLUMNS)[number];
export type ResourceSortColumn = (typeof ALLOWED_RESOURCE_SORT_COLUMNS)[number];
export type ActionSortColumn = (typeof ALLOWED_ACTION_SORT_COLUMNS)[number];
export type FeatureFlagSortColumn =
  (typeof ALLOWED_FEATURE_FLAG_SORT_COLUMNS)[number];
