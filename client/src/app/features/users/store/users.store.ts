import { computed, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
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
  withEntities
} from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { UserService } from '../services/user.service';
import type { UpdateUser, User, UserSearch } from '../models/user.types';

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
    pageSize: 10
  }),
  withComputed((store) => ({
    displayedUsers: computed(() => {
      const all = store.entities();
      const start = store.currentPage() * store.pageSize();
      const end = start + store.pageSize();
      return all.slice(start, end);
    }),
    totalUsers: computed(() => store.entities().length),
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
          switchMap(() =>
            userService.getAll().pipe(
              tapResponse({
                next: (users) => {
                  patchState(store, setAllEntities(users));
                  patchState(store, { listLoading: false });
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
          tap(() =>
            patchState(store, {
              searchLoading: true,
              searchError: null,
              searchPerformed: false
            })
          ),
          switchMap((criteria) =>
            userService.search(criteria).pipe(
              tapResponse({
                next: (users) => {
                  for (const user of users) {
                    patchState(store, setEntity(user));
                  }
                  patchState(store, {
                    searchResultIds: users.map((u) => u.id),
                    searchLoading: false,
                    searchPerformed: true
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

      clearSearch(): void {
        patchState(store, {
          searchResultIds: [],
          searchPerformed: false,
          searchError: null
        });
      }
    };
  })
);
