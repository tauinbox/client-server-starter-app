import { computed, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { pipe, switchMap, tap } from 'rxjs';
import { tapResponse } from '@ngrx/operators';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import {
  removeEntity,
  setEntity,
  updateEntity,
  withEntities
} from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { NotifyService } from '@core/services/notify.service';
import { withCursorList } from '@shared/store/with-cursor-list';
import type { CursorPageRequest } from '@shared/utils/pagination.utils';
import { UserService } from '../services/user.service';
import type {
  CursorPaginatedResponse,
  SortOrder,
  UpdateUser,
  User,
  UserCursorListParams,
  UserSearch,
  UserSortColumn
} from '../models/user.types';

type UsersState = {
  detailLoading: boolean;
  detailError: string | null;
  filters: UserSearch;
};

export const UsersStore = signalStore(
  withEntities<User>(),
  withState<UsersState>({
    detailLoading: false,
    detailError: null,
    filters: {}
  }),
  withCursorList<User>({ errorKey: 'users.store.errorLoadFailed' }),
  withComputed((store) => ({
    displayedUsers: computed(() => store.entities()),
    // Keyset pagination reports no total, so the count shown is what has been
    // loaded so far; `hasMore` is what tells the UI there is more behind it.
    loadedUsers: computed(() => store.ids().length)
  })),
  withMethods((store) => {
    const userService = inject(UserService);
    const notify = inject(NotifyService);

    /**
     * Filters decide which of the two cursor endpoints answers, so the fetcher
     * is rebuilt per call rather than captured once.
     */
    function fetchPage(
      request: CursorPageRequest
    ): Observable<CursorPaginatedResponse<User>> {
      const filters = store.filters();
      const params: UserCursorListParams = {
        cursor: request.cursor ?? undefined,
        limit: request.limit ?? 20,
        sortBy: (request.sortBy as UserSortColumn) ?? 'createdAt',
        sortOrder: request.sortOrder ?? 'desc'
      };
      const hasFilters = !!(
        filters.q ||
        filters.role ||
        filters.isActive !== undefined ||
        filters.includeDeleted
      );
      return hasFilters
        ? userService.searchCursor(filters, params)
        : userService.getAllCursor(params);
    }

    return {
      load(): void {
        void store.loadFirstPage(fetchPage);
      },

      loadMore(): void {
        void store.loadNextPage(fetchPage);
      },

      loadOne: rxMethod<string>(
        pipe(
          tap(() =>
            patchState(store, { detailLoading: true, detailError: null })
          ),
          switchMap((id) =>
            userService.getById(id).pipe(
              tapResponse({
                next: (user) => {
                  patchState(store, setEntity(user));
                  patchState(store, { detailLoading: false });
                },
                error: () => {
                  patchState(store, {
                    detailLoading: false,
                    detailError: 'users.store.errorLoadDetailsFailed'
                  });
                  notify.error('users.store.errorLoadDetailsFailed');
                }
              })
            )
          )
        )
      ),

      updateUser(id: string, data: UpdateUser): Observable<User> {
        return userService.update(id, data).pipe(
          tap((user) => {
            patchState(store, setEntity(user));
          })
        );
      },

      deleteUser(id: string): Observable<void> {
        return userService.delete(id).pipe(
          tap(() => {
            // While deleted users are on screen the row must stay visible and
            // flip to its deleted state instead of vanishing from the list.
            if (store.filters().includeDeleted) {
              patchState(
                store,
                updateEntity({
                  id,
                  changes: { deletedAt: new Date().toISOString() }
                })
              );
              return;
            }
            patchState(store, removeEntity(id));
          })
        );
      },

      restoreUser(id: string): Observable<User> {
        return userService.restore(id).pipe(
          tap((user) => {
            patchState(store, setEntity(user));
          })
        );
      },

      setFilters(filters: UserSearch): void {
        patchState(store, { filters });
      },

      setSorting(sortBy: UserSortColumn, sortOrder: SortOrder): void {
        store.setSorting(sortBy, sortOrder);
      }
    };
  })
);
