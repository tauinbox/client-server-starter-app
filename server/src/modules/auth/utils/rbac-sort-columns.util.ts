import { RESOURCE_LIST_QUERY, ROLE_LIST_QUERY } from '@app/shared/constants';
import type { ListColumns } from '../../../common/utils/apply-list-query.util';

/** The columns of the RBAC admin catalogs, for `applyList`. */
export const ROLE_LIST_COLUMNS: ListColumns<typeof ROLE_LIST_QUERY> = {
  search: { name: 'role.name', description: 'role.description' },
  filters: { isSystem: 'role.isSystem' },
  sort: { createdAt: 'role.createdAt', name: 'role.name' },
  id: 'role.id'
};

export const RESOURCE_LIST_COLUMNS: ListColumns<typeof RESOURCE_LIST_QUERY> = {
  search: {
    displayName: 'resource.displayName',
    name: 'resource.name',
    subject: 'resource.subject',
    description: 'resource.description'
  },
  filters: {
    isSystem: 'resource.isSystem',
    isOrphaned: 'resource.isOrphaned'
  },
  sort: { createdAt: 'resource.createdAt', name: 'resource.name' },
  id: 'resource.id'
};
