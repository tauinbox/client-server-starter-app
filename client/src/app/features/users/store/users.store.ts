import { computed, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Observable } from 'rxjs';
import { map, pipe, switchMap, tap } from 'rxjs';
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
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER
} from '@app/shared/constants';
import { UserService } from '../services/user.service';
import type {
  SortOrder,
  UpdateUser,
  User,
  UserSearch,
  UserSortColumn
} from '../models/user.types';

type UsersExtraState = {
  listLoading: boolean;
  detailLoading: boolean;
  searchLoading: boolean;
  listError: string | null;
  detailError: string | null;
  searchError: string | null;
  searchResultIds: string[];
  searchPerformed: boolean;
  currentPage: number;
  pageSize: number;
  totalUsers: number;
  sortBy: UserSortColumn;
  sortOrder: SortOrder;
  searchCurrentPage: number;
  searchPageSize: number;
  searchTotalUsers: number;
  searchSortBy: UserSortColumn;
  searchSortOrder: SortOrder;
  lastSearchCriteria: UserSearch | null;
};

export const UsersStore = signalStore(
  withEntities<User>(),
  withState<UsersExtraState>({
    listLoading: false,
    detailLoading: false,
    searchLoading: false,
    listError: null,
    detailError: null,
    searchError: null,
    searchResultIds: [],
    searchPerformed: false,
    currentPage: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    totalUsers: 0,
    sortBy: DEFAULT_SORT_BY as UserSortColumn,
    sortOrder: DEFAULT_SORT_ORDER,
    searchCurrentPage: 0,
    searchPageSize: DEFAULT_PAGE_SIZE,
    searchTotalUsers: 0,
    searchSortBy: DEFAULT_SORT_BY as UserSortColumn,
    searchSortOrder: DEFAULT_SORT_ORDER,
    lastSearchCriteria: null
  }),
  withComputed((store) => ({
    displayedUsers: computed(() => store.entities()),
    searchResultUsers: computed(() => {
      const map = store.entityMap();
      return store
        .searchResultIds()
        .map((id) => map[id])
        .filter(Boolean) as User[];
    })
  })),
  withMethods((store) => {
    const userService = inject(UserService);
    const snackBar = inject(MatSnackBar);

    return {
      loadAll: rxMethod<void>(
        pipe(
          tap(() => patchState(store, { listLoading: true, listError: null })),
          map(() => ({
            page: store.currentPage() + 1,
            limit: store.pageSize(),
            sortBy: store.sortBy(),
            sortOrder: store.sortOrder()
          })),
          switchMap((params) =>
            userService.getAll(params).pipe(
              tapResponse({
                next: (response) => {
                  patchState(store, setAllEntities(response.data));
                  patchState(store, {
                    listLoading: false,
                    totalUsers: response.meta.total
                  });
                },
                error: () => {
                  patchState(store, {
                    listLoading: false,
                    listError: 'Failed to load users. Please try again.'
                  });
                  snackBar.open(
                    'Failed to load users. Please try again.',
                    'Close',
                    { duration: 5000 }
                  );
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
                    detailError:
                      'Failed to load user details. Please try again.'
                  });
                  snackBar.open(
                    'Failed to load user details. Please try again.',
                    'Close',
                    { duration: 5000 }
                  );
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
          })
        );
      },

      search: rxMethod<UserSearch>(
        pipe(
          tap((criteria) =>
            patchState(store, {
              searchLoading: true,
              searchError: null,
              searchPerformed: false,
              lastSearchCriteria: criteria
            })
          ),
          map((criteria) => ({
            criteria,
            page: store.searchCurrentPage() + 1,
            limit: store.searchPageSize(),
            sortBy: store.searchSortBy(),
            sortOrder: store.searchSortOrder()
          })),
          switchMap(({ criteria, ...params }) =>
            userService.search(criteria, params).pipe(
              tapResponse({
                next: (response) => {
                  patchState(store, upsertEntities(response.data));
                  patchState(store, {
                    searchResultIds: response.data.map((u) => u.id),
                    searchLoading: false,
                    searchPerformed: true,
                    searchTotalUsers: response.meta.total
                  });
                },
                error: () => {
                  patchState(store, {
                    searchLoading: false,
                    searchError: 'Failed to search users. Please try again.'
                  });
                  snackBar.open(
                    'Failed to search users. Please try again.',
                    'Close',
                    { duration: 5000 }
                  );
                }
              })
            )
          )
        )
      ),

      setPage(page: number): void {
        patchState(store, { currentPage: page });
      },

      setPageSize(size: number): void {
        patchState(store, { pageSize: size, currentPage: 0 });
      },

      setSorting(sortBy: UserSortColumn, sortOrder: SortOrder): void {
        patchState(store, { sortBy, sortOrder, currentPage: 0 });
      },

      setSearchPage(page: number): void {
        patchState(store, { searchCurrentPage: page });
      },

      setSearchPageSize(size: number): void {
        patchState(store, { searchPageSize: size, searchCurrentPage: 0 });
      },

      setSearchSorting(sortBy: UserSortColumn, sortOrder: SortOrder): void {
        patchState(store, {
          searchSortBy: sortBy,
          searchSortOrder: sortOrder,
          searchCurrentPage: 0
        });
      },

      clearSearch(): void {
        patchState(store, {
          searchResultIds: [],
          searchPerformed: false,
          searchError: null,
          searchTotalUsers: 0,
          searchCurrentPage: 0,
          lastSearchCriteria: null
        });
      }
    };
  })
);
