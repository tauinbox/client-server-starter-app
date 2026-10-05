import { signal } from '@angular/core';
import { DEFAULT_SORT_BY, DEFAULT_SORT_ORDER } from '@app/shared/constants';
import type { ListQuerySpec, SortOrder } from '@app/shared/types';
import type { ListUrlKey } from '@shared/store/list-url-state';

/**
 * The members of a `withList` store that `bindListToUrl` reads and drives.
 * Spread it into a store mock of a list page; `filters` stays the mock's own.
 */
export function listUrlStoreMock(spec: ListQuerySpec, urlKey: ListUrlKey) {
  return {
    listSpec: spec,
    listUrlKey: urlKey,
    sortBy: signal(DEFAULT_SORT_BY),
    sortOrder: signal<SortOrder>(DEFAULT_SORT_ORDER),
    setSorting: vi.fn(),
    setFilters: vi.fn(),
    load: vi.fn()
  };
}
