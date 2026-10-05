import type { Signal } from '@angular/core';
import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { SortDirection } from '@angular/material/sort';
import { DEFAULT_SORT_BY, DEFAULT_SORT_ORDER } from '@app/shared/constants';
import type { ListFilters, ListQuerySpec, SortOrder } from '@app/shared/types';
import {
  isListUrlCanonical,
  type ListUrlKey,
  type ListUrlState,
  listUrlParam,
  listUrlParams,
  readListUrl
} from './list-url-state';

/** The part of a `withList` store that the URL binding reads and drives. */
export type ListUrlStore<S extends ListQuerySpec> = {
  listSpec: S;
  listUrlKey: ListUrlKey;
  filters: Signal<Partial<ListFilters<S>>>;
  sortBy: Signal<string>;
  sortOrder: Signal<SortOrder>;
  setFilters(filters: Partial<ListFilters<S>>): void;
  setSorting(sortBy: string, sortOrder: SortOrder): void;
  load(): void;
};

/** The sort as a `matSort` shows it: nothing marked for the default sort. */
export type ListSortView = { active: string; direction: SortDirection };

export type ListUrlBinding<S extends ListQuerySpec> = {
  /** Writes new filters to the URL; the list follows the URL. */
  setFilters(filters: Partial<ListFilters<S>>): void;
  /** Writes a sort to the URL; an empty column or direction is the default. */
  setSort(sortBy: string, direction: SortDirection): void;
  readonly sort: Signal<ListSortView>;
};

function onlySearchChanged(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>
): boolean {
  const names = new Set([...Object.keys(previous), ...Object.keys(next)]);
  names.delete('q');
  return [...names].every((name) => previous[name] === next[name]);
}

/**
 * Makes the URL the source of truth for the filters and the sort of the list
 * in `store`. Call it in the constructor of the page component that shows the
 * list; it lives as long as that component.
 *
 * Each URL change - the first visit, a link, Back or Forward, or a change made
 * through the returned binding - is parsed, written to the store and loaded
 * from the first page, once, and only when it differs from what the store
 * last loaded. A user change only navigates, so there is one path and no
 * loop. The page never calls `load()` for the first page itself.
 */
export function bindListToUrl<S extends ListQuerySpec>(
  store: ListUrlStore<S>
): ListUrlBinding<S> {
  const router = inject(Router);
  const route = inject(ActivatedRoute);
  const key = store.listUrlKey;
  const spec = store.listSpec;
  let loaded: string | null = null;

  function navigate(state: ListUrlState<S>, replaceUrl: boolean): void {
    // `merge` keeps every param it is not given, so a param of this list that
    // the canonical form does not name (an unknown one) is removed explicitly.
    const stale = route.snapshot.queryParamMap.keys
      .filter((name) => name.startsWith(listUrlParam(key, '')))
      .map((name) => [name, null]);
    void router.navigate([], {
      relativeTo: route,
      queryParams: {
        ...Object.fromEntries(stale),
        ...listUrlParams(key, spec, state)
      },
      queryParamsHandling: 'merge',
      replaceUrl
    });
  }

  route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
    const state = readListUrl(params, key, spec);
    const canonical = listUrlParams(key, spec, state);
    if (!isListUrlCanonical(params, key, canonical)) {
      navigate(state, true);
    }
    const signature = JSON.stringify(canonical);
    if (signature === loaded) return;
    loaded = signature;
    store.setFilters(state.filters);
    store.setSorting(state.sortBy, state.sortOrder);
    store.load();
  });

  return {
    setFilters(filters) {
      navigate(
        { filters, sortBy: store.sortBy(), sortOrder: store.sortOrder() },
        // A pause in typing is not a step that Back should undo.
        onlySearchChanged(store.filters(), filters)
      );
    },

    setSort(sortBy, direction) {
      const isDefault = sortBy === '' || direction === '';
      navigate(
        {
          filters: store.filters(),
          sortBy: isDefault ? DEFAULT_SORT_BY : sortBy,
          sortOrder: isDefault ? DEFAULT_SORT_ORDER : direction
        },
        false
      );
    },

    sort: computed(() =>
      store.sortBy() === DEFAULT_SORT_BY &&
      store.sortOrder() === DEFAULT_SORT_ORDER
        ? { active: '', direction: '' }
        : { active: store.sortBy(), direction: store.sortOrder() }
    )
  };
}
