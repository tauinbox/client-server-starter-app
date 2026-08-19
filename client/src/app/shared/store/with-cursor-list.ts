import { inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import {
  patchState,
  signalStoreFeature,
  type,
  withMethods,
  withState
} from '@ngrx/signals';
import type { EntityState } from '@ngrx/signals/entities';
import { setAllEntities, upsertEntities } from '@ngrx/signals/entities';
import type { HttpErrorResponse } from '@angular/common/http';
import { DEFAULT_SORT_BY, DEFAULT_SORT_ORDER } from '@app/shared/constants';
import type { CursorPaginatedResponse, SortOrder } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import {
  CURSOR_PAGE_SIZE,
  type CursorPageRequest
} from '@shared/utils/pagination.utils';

/** Fetches one page; the store supplies its own filters around this. */
export type CursorListFetcher<Entity> = (
  request: CursorPageRequest
) => Observable<CursorPaginatedResponse<Entity>>;

export type CursorListState = {
  loading: boolean;
  isLoadingMore: boolean;
  nextCursor: string | null;
  hasMore: boolean;
  sortBy: string;
  sortOrder: SortOrder;
};

const initialCursorListState: CursorListState = {
  loading: false,
  isLoadingMore: false,
  nextCursor: null,
  hasMore: false,
  sortBy: DEFAULT_SORT_BY,
  sortOrder: DEFAULT_SORT_ORDER
};

/**
 * The project standard for every list page (see the pagination rule in the
 * contributor guide): keyset pagination behind an infinite scroll, one
 * collection per store.
 *
 * The feature owns the paging protocol - cursor bookkeeping, the in-flight
 * guards, appending rather than replacing on a subsequent page, and the
 * stale-response guard - while each store supplies the query through
 * `loadFirstPage` / `loadNextPage`, because filters differ per entity and live
 * in the consuming store's own state.
 */
export function withCursorList<Entity extends { id: string }>(config: {
  /**
   * Client-owned translation key for a failed load; both paths report through
   * it. Not a server `errorKey` - that word is reserved for the key the server
   * sends, which may have no translation and must never be rendered directly.
   */
  fallbackKey: string;
  limit?: number;
}) {
  const limit = config.limit ?? CURSOR_PAGE_SIZE;

  return signalStoreFeature(
    { state: type<EntityState<Entity>>() },
    withState<CursorListState>(initialCursorListState),
    withMethods((store) => {
      const notify = inject(NotifyService);

      // Monotonic token: a filter or sort change starts a new sequence, and a
      // response from an abandoned one must not be written. Without this a slow
      // first request can land after a faster later one and restore stale rows.
      let sequence = 0;

      function request(cursor: string | null): CursorPageRequest {
        return {
          cursor,
          limit,
          sortBy: store.sortBy(),
          sortOrder: store.sortOrder()
        };
      }

      async function loadFirstPage(
        fetcher: CursorListFetcher<Entity>
      ): Promise<void> {
        const token = ++sequence;
        patchState(store, { loading: true });
        try {
          const page = await firstValueFrom(fetcher(request(null)));
          if (token !== sequence) return;
          patchState(store, setAllEntities(page.data));
          patchState(store, {
            nextCursor: page.meta.nextCursor,
            hasMore: page.meta.hasMore
          });
        } catch (error) {
          if (token !== sequence) return;
          notify.error(error as HttpErrorResponse, config.fallbackKey);
        } finally {
          if (token === sequence) patchState(store, { loading: false });
        }
      }

      /**
       * Appends the next page. A call without a cursor, while one is already in
       * flight, or after the server reported no more rows is a no-op, so the
       * scroll sentinel can fire freely.
       */
      async function loadNextPage(
        fetcher: CursorListFetcher<Entity>
      ): Promise<void> {
        const cursor = store.nextCursor();
        if (
          !cursor ||
          !store.hasMore() ||
          store.loading() ||
          store.isLoadingMore()
        ) {
          return;
        }

        const token = sequence;
        patchState(store, { isLoadingMore: true });
        try {
          const page = await firstValueFrom(fetcher(request(cursor)));
          if (token !== sequence) return;
          patchState(store, upsertEntities(page.data));
          patchState(store, {
            nextCursor: page.meta.nextCursor,
            hasMore: page.meta.hasMore
          });
        } catch (error) {
          if (token !== sequence) return;
          notify.error(error as HttpErrorResponse, config.fallbackKey);
        } finally {
          if (token === sequence) patchState(store, { isLoadingMore: false });
        }
      }

      /**
       * Changing the sort invalidates every cursor already handed out, so the
       * caller must reload from the first page afterwards.
       */
      function setSorting(sortBy: string, sortOrder: SortOrder): void {
        patchState(store, {
          sortBy,
          sortOrder,
          nextCursor: null,
          hasMore: false
        });
      }

      return { loadFirstPage, loadNextPage, setSorting };
    })
  );
}
