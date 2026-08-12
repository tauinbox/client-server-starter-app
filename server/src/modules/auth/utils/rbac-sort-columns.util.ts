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

export const ACTION_SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: 'action.createdAt',
  name: 'action.name'
};
