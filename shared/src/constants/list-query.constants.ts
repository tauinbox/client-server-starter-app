import type {
  ListFilters,
  ListQuery,
  ListQuerySpec
} from '../types/list-query.types';
import { APP_ENVIRONMENTS } from './environment.constants';
import {
  ALLOWED_FEATURE_FLAG_SORT_COLUMNS,
  ALLOWED_INVOICE_SORT_COLUMNS,
  ALLOWED_RESOURCE_SORT_COLUMNS,
  ALLOWED_ROLE_SORT_COLUMNS,
  ALLOWED_SUBSCRIPTION_SORT_COLUMNS
} from './sort-columns.constants';
import { ALLOWED_USER_SORT_COLUMNS } from './user.constants';

/**
 * Cap for `q` and for every text filter of a list. The searchable values are
 * capped at 255 on write, so a longer needle cannot match anything - accepting
 * it only builds a larger ILIKE pattern.
 */
export const MAX_LIST_FILTER_LENGTH = 255;

export const USER_LIST_QUERY = {
  search: ['email', 'firstName', 'lastName', 'id'],
  filters: {
    email: { kind: 'contains' },
    firstName: { kind: 'contains' },
    lastName: { kind: 'contains' },
    ids: { kind: 'uuidList', field: 'id' },
    isActive: { kind: 'boolean' },
    isEmailVerified: { kind: 'boolean' },
    mfaEnabled: { kind: 'isSet', field: 'totpEnabledAt' },
    hasPassword: { kind: 'isSet', field: 'password' },
    isLocked: { kind: 'inFuture', field: 'lockedUntil' }
  },
  params: {
    /** Users that have a role with this exact name (a join). */
    role: { kind: 'contains' },
    /** Soft-deleted users are listed too (a scope switch). */
    includeDeleted: { kind: 'boolean' }
  },
  sort: ALLOWED_USER_SORT_COLUMNS
} as const satisfies ListQuerySpec;

export const FEATURE_FLAG_LIST_QUERY = {
  search: ['key', 'description'],
  filters: {
    enabled: { kind: 'boolean' },
    public: { kind: 'boolean' },
    environment: {
      kind: 'scopeIncludes',
      field: 'environments',
      values: APP_ENVIRONMENTS
    }
  },
  sort: ALLOWED_FEATURE_FLAG_SORT_COLUMNS
} as const satisfies ListQuerySpec;

export const ROLE_LIST_QUERY = {
  search: ['name', 'description'],
  filters: {
    isSystem: { kind: 'boolean' }
  },
  sort: ALLOWED_ROLE_SORT_COLUMNS
} as const satisfies ListQuerySpec;

export const RESOURCE_LIST_QUERY = {
  search: ['displayName', 'name', 'subject', 'description'],
  filters: {
    isSystem: { kind: 'boolean' },
    isOrphaned: { kind: 'boolean' }
  },
  sort: ALLOWED_RESOURCE_SORT_COLUMNS
} as const satisfies ListQuerySpec;

export const SUBSCRIPTION_LIST_QUERY = {
  search: [],
  filters: {},
  sort: ALLOWED_SUBSCRIPTION_SORT_COLUMNS
} as const satisfies ListQuerySpec;

export const INVOICE_LIST_QUERY = {
  search: [],
  filters: {},
  sort: ALLOWED_INVOICE_SORT_COLUMNS
} as const satisfies ListQuerySpec;

export type UserListQuery = ListQuery<typeof USER_LIST_QUERY>;
export type UserListFilters = ListFilters<typeof USER_LIST_QUERY>;
export type FeatureFlagListQuery = ListQuery<typeof FEATURE_FLAG_LIST_QUERY>;
export type RoleListQuery = ListQuery<typeof ROLE_LIST_QUERY>;
export type ResourceListQuery = ListQuery<typeof RESOURCE_LIST_QUERY>;
