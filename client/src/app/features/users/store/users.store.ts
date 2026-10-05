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
import { removeEntity, setEntity, updateEntity } from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { USER_LIST_QUERY } from '@app/shared/constants';
import { NotifyService } from '@core/services/notify.service';
import { type ListFetcher, withList } from '@shared/store/with-list';
import {
  type CursorPageRequest,
  isActiveFilterValue
} from '@shared/utils/pagination.utils';
import { UserService } from '../services/user.service';
import type { MfaResetRequest } from '../services/user.service';
import type {
  UpdateUser,
  User,
  UserCursorListParams,
  UserSearch,
  UserSortColumn
} from '../models/user.types';

type UsersState = {
  detailLoading: boolean;
  detailError: string | null;
};

/**
 * Filters decide which of the two cursor endpoints answers, so the endpoint is
 * chosen per page rather than captured once.
 */
function userFetcher(): ListFetcher<User, typeof USER_LIST_QUERY> {
  const userService = inject(UserService);
  return (request: CursorPageRequest, filters: UserSearch) => {
    const params: UserCursorListParams = {
      cursor: request.cursor ?? undefined,
      limit: request.limit ?? 20,
      sortBy: (request.sortBy as UserSortColumn) ?? 'createdAt',
      sortOrder: request.sortOrder ?? 'desc'
    };
    return Object.values(filters).some(isActiveFilterValue)
      ? userService.searchCursor(filters, params)
      : userService.getAllCursor(params);
  };
}

export const UsersStore = signalStore(
  withState<UsersState>({
    detailLoading: false,
    detailError: null
  }),
  withList({
    spec: USER_LIST_QUERY,
    urlKey: 'users',
    fallbackKey: 'users.store.errorLoadFailed',
    fetcher: userFetcher
  }),
  withComputed((store) => ({
    displayedUsers: computed(() => store.entities()),
    // Keyset pagination reports no total, so the count shown is what has been
    // loaded so far; `hasMore` is what tells the UI there is more behind it.
    loadedUsers: computed(() => store.ids().length)
  })),
  withMethods((store) => {
    const userService = inject(UserService);
    const notify = inject(NotifyService);

    return {
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

      resetMfa(id: string, request: MfaResetRequest): Observable<User> {
        return userService.resetMfa(id, request).pipe(
          tap((user) => {
            patchState(store, setEntity(user));
          })
        );
      }
    };
  })
);
