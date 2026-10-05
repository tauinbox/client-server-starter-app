import { RESOURCE_LIST_QUERY, ROLE_LIST_QUERY } from '@app/shared/constants';
import type { ListQueryColumns } from '../../../common/utils/apply-list-query.util';

/**
 * Keyset sort maps for the RBAC admin catalogs: query-string `sortBy` ->
 * qualified column. The cursor DTOs (`common/dtos/entity-cursor-query.dto.ts`)
 * reject anything outside these keys before a query is built.
 */
export const ROLE_SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: 'role.createdAt',
  name: 'role.name'
};

export const RESOURCE_SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: 'resource.createdAt',
  name: 'resource.name'
};

/** Search and filter columns of the same catalogs, for `applyListQuery`. */
export const ROLE_LIST_COLUMNS: ListQueryColumns<typeof ROLE_LIST_QUERY> = {
  search: { name: 'role.name', description: 'role.description' },
  filters: { isSystem: 'role.isSystem' }
};

export const RESOURCE_LIST_COLUMNS: ListQueryColumns<
  typeof RESOURCE_LIST_QUERY
> = {
  search: {
    displayName: 'resource.displayName',
    name: 'resource.name',
    subject: 'resource.subject',
    description: 'resource.description'
  },
  filters: {
    isSystem: 'resource.isSystem',
    isOrphaned: 'resource.isOrphaned'
  }
};
