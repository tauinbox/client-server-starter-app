import { computed, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
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
  setAllEntities,
  setEntity,
  upsertEntities,
  withEntities
} from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { DEFAULT_SORT_BY, DEFAULT_SORT_ORDER } from '@app/shared/constants';
import { NotifyService } from '@core/services/notify.service';
import { UserService } from '../services/user.service';
import type {
  PaginatedResponse,
  SortOrder,
  UpdateUser,
  User,
  UserListParams,
  UserSearch,
  UserSortColumn
} from '../models/user.types';

const INFINITE_SCROLL_PAGE_SIZE = 20;

type UsersState = {
  loading: boolean;
  isLoadingMore: boolean;
  detailLoading: boolean;
  error: string | null;
  detailError: string | null;
  currentPage: number;
  pageSize: number;
  totalUsers: number;
  sortBy: UserSortColumn;
  sortOrder: SortOrder;
  filters: UserSearch;
};

export const UsersStore = signalStore(
  withEntities<User>(),
  withState<UsersState>({
    loading: false,
    isLoadingMore: false,
    detailLoading: false,
    error: null,
    detailError: null,
    currentPage: 0,
    pageSize: INFINITE_SCROLL_PAGE_SIZE,
    totalUsers: 0,
    sortBy: DEFAULT_SORT_BY as UserSortColumn,
    sortOrder: DEFAULT_SORT_ORDER,
    filters: {}
  }),
  withComputed((store) => ({
    displayedUsers: computed(() => store.entities()),
    hasMore: computed(() => store.totalUsers() > store.ids().length)
  })),
  withMethods((store) => {
    const userService = inject(UserService);
    const notify = inject(NotifyService);
    const translocoService = inject(TranslocoService);

    function buildRequest(page: number): Observable<PaginatedResponse<User>> {
      const params: UserListParams = {
        page,
        limit: store.pageSize(),
        sortBy: store.sortBy(),
        sortOrder: store.sortOrder()
      };
      const filters = store.filters();
      const hasFilters = !!(
        filters.email ||
        filters.firstName ||
        filters.lastName ||
        filters.isActive !== undefined
      );
      return hasFilters
        ? userService.search(filters, params)
        : userService.getAll(params);
    }

    return {
      load: rxMethod<void>(
        pipe(
          tap(() =>
            patchState(store, { loading: true, error: null, currentPage: 0 })
          ),
          switchMap(() =>
            buildRequest(1).pipe(
              tapResponse({
                next: (response) => {
                  patchState(store, setAllEntities(response.data));
                  patchState(store, {
                    loading: false,
                    totalUsers: response.meta.total
                  });
                },
                error: () => {
                  patchState(store, {
                    loading: false,
                    error: translocoService.translate(
                      'users.store.errorLoadFailed'
                    )
                  });
                  notify.error('users.store.errorLoadFailed');
                }
              })
            )
          )
        )
      ),

      loadMore: rxMethod<void>(
        pipe(
          tap(() => {
            patchState(store, {
              isLoadingMore: true,
              error: null,
              currentPage: store.currentPage() + 1
            });
          }),
          switchMap(() =>
            buildRequest(store.currentPage() + 1).pipe(
              tapResponse({
                next: (response) => {
                  patchState(store, upsertEntities(response.data));
                  patchState(store, {
                    isLoadingMore: false,
                    totalUsers: response.meta.total
                  });
                },
                error: () => {
                  patchState(store, {
                    isLoadingMore: false,
                    currentPage: store.currentPage() - 1,
                    error: translocoService.translate(
                      'users.store.errorLoadMoreFailed'
                    )
                  });
                  notify.error('users.store.errorLoadMoreFailed');
                }
              })
            )
          )
        )
      ),

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
                    detailError: translocoService.translate(
                      'users.store.errorLoadDetailsFailed'
                    )
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
            patchState(store, removeEntity(id));
            patchState(store, {
              totalUsers: Math.max(0, store.totalUsers() - 1)
            });
          })
        );
      },

      setFilters(filters: UserSearch): void {
        patchState(store, { filters });
      },

      setSorting(sortBy: UserSortColumn, sortOrder: SortOrder): void {
        patchState(store, { sortBy, sortOrder });
      }
    };
  })
);
