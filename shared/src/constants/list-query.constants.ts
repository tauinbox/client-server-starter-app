import type { ListQuery, ListQuerySpec } from '../types/list-query.types';
import { APP_ENVIRONMENTS } from './environment.constants';

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
  }
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
  }
} as const satisfies ListQuerySpec;

export const ROLE_LIST_QUERY = {
  search: ['name', 'description'],
  filters: {
    isSystem: { kind: 'boolean' }
  }
} as const satisfies ListQuerySpec;

export const RESOURCE_LIST_QUERY = {
  search: ['displayName', 'name', 'subject', 'description'],
  filters: {
    isSystem: { kind: 'boolean' },
    isOrphaned: { kind: 'boolean' }
  }
} as const satisfies ListQuerySpec;

export type UserListQuery = ListQuery<typeof USER_LIST_QUERY>;
export type FeatureFlagListQuery = ListQuery<typeof FEATURE_FLAG_LIST_QUERY>;
export type RoleListQuery = ListQuery<typeof ROLE_LIST_QUERY>;
export type ResourceListQuery = ListQuery<typeof RESOURCE_LIST_QUERY>;
