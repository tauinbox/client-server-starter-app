/**
 * Sortable columns of every cursor-paginated list endpoint, shared so the
 * server DTO, the mock and the client agree on one whitelist.
 *
 * Keyset pagination compares `(sortColumn, id)` tuples, and a NULL on either
 * side of that comparison silently drops rows, so **only NOT NULL columns may
 * be listed here**. Check the entity before adding one.
 *
 * A sortable column must also **carry no precision the cursor cannot
 * represent**. The cursor is built from the value the application read back and
 * encoded with `JSON.stringify`, so a timestamp survives it only to the
 * millisecond: a `timestamptz` column filled by Postgres `now()` stores
 * microseconds, and the resulting cursor names a point before the row it came
 * from, dropping rows on `desc` and repeating them on `asc`. Declare timestamp
 * sort keys as `timestamptz(3)`; `test/instants-timestamptz.e2e-spec.ts` fails
 * on any that are wider.
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
