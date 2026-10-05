import { computed } from '@angular/core';
import {
  patchState,
  signalStoreFeature,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import { isActiveFilterValue } from '@shared/utils/pagination.utils';

export type ListFiltersState<F extends object> = { filters: F };

/**
 * The search and filter state of a list store. Compose it before the store's
 * `load()`, which reads `filters()` when it builds the request; after
 * `setFilters` the caller reloads from the first page.
 */
export function withListFilters<F extends object>(initial: F) {
  return signalStoreFeature(
    withState<ListFiltersState<F>>({ filters: initial }),
    withComputed((store) => ({
      hasActiveFilters: computed(() =>
        Object.values(store.filters()).some(isActiveFilterValue)
      )
    })),
    withMethods((store) => ({
      setFilters(filters: F): void {
        patchState(store, { filters });
      }
    }))
  );
}
