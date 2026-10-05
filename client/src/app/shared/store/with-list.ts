import type { Observable } from 'rxjs';
import { signalStoreFeature, withMethods, withProps } from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';
import type {
  CursorPaginatedResponse,
  ListFilters,
  ListQuerySpec
} from '@app/shared/types';
import type { CursorPageRequest } from '@shared/utils/pagination.utils';
import { type CursorListFetcher, withCursorList } from './with-cursor-list';
import { withListFilters } from './with-list-filters';
import type { ListUrlKey } from './list-url-state';

/** Fetches one page of a list with the filters the store holds now. */
export type ListFetcher<Entity, S extends ListQuerySpec> = (
  request: CursorPageRequest,
  filters: Partial<ListFilters<S>>
) => Observable<CursorPaginatedResponse<Entity>>;

/**
 * The project standard for every list store: one entity collection, keyset
 * pagination (`withCursorList`), the filter state of the shared list definition
 * (`withListFilters`), and `load()` / `loadMore()`. `bindListToUrl` keeps the
 * filters and the sort of the store in the URL of the page that shows it.
 */
export function withList<
  Entity extends { id: string },
  S extends ListQuerySpec
>(config: {
  spec: S;
  /** The URL param prefix of this list; see `LIST_URL_KEYS`. */
  urlKey: ListUrlKey;
  fallbackKey: string;
  /** Called once in the injection context of the store. */
  fetcher: () => ListFetcher<Entity, S>;
}) {
  const noFilters: Partial<ListFilters<S>> = {};
  return signalStoreFeature(
    withEntities<Entity>(),
    withCursorList<Entity>({ fallbackKey: config.fallbackKey }),
    withListFilters(noFilters),
    withProps(() => ({ listSpec: config.spec, listUrlKey: config.urlKey })),
    withMethods((store) => {
      const fetch = config.fetcher();
      const page: CursorListFetcher<Entity> = (request) =>
        fetch(request, store.filters());

      return {
        /** First page; a filter or sort change re-enters through here. */
        load(): void {
          void store.loadFirstPage(page);
        },

        /** Appends the next page; wired to the list's scroll sentinel. */
        loadMore(): void {
          void store.loadNextPage(page);
        }
      };
    })
  );
}
