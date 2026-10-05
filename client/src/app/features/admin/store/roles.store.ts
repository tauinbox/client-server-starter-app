import { inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { patchState, signalStore, withMethods } from '@ngrx/signals';
import { removeEntity, setEntity, withEntities } from '@ngrx/signals/entities';
import type { RoleAdminResponse } from '@app/shared/types';
import type { RoleListQuery } from '@app/shared/constants';
import { withCursorList } from '@shared/store/with-cursor-list';
import { withListFilters } from '@shared/store/with-list-filters';
import type { CreateRole, UpdateRole } from '../services/role.service';
import { RoleService } from '../services/role.service';

export const RolesStore = signalStore(
  withEntities<RoleAdminResponse>(),
  withCursorList<RoleAdminResponse>({
    fallbackKey: 'admin.store.errorLoadRolesFailed'
  }),
  withListFilters<RoleListQuery>({}),
  withMethods((store) => {
    const roleService = inject(RoleService);

    return {
      /** First page; a filter or sort change re-enters through here. */
      load(): void {
        void store.loadFirstPage((request) =>
          roleService.getAllCursor(request, store.filters())
        );
      },

      /** Appends the next page; wired to the list's scroll sentinel. */
      loadMore(): void {
        void store.loadNextPage((request) =>
          roleService.getAllCursor(request, store.filters())
        );
      },

      createRole(data: CreateRole): Observable<RoleAdminResponse> {
        return roleService.create(data).pipe(
          tap((role) => {
            patchState(store, setEntity(role));
          })
        );
      },

      updateRole(id: string, data: UpdateRole): Observable<RoleAdminResponse> {
        return roleService.update(id, data).pipe(
          tap((role) => {
            patchState(store, setEntity(role));
          })
        );
      },

      deleteRole(id: string): Observable<void> {
        return roleService.delete(id).pipe(
          tap(() => {
            patchState(store, removeEntity(id));
          })
        );
      }
    };
  })
);
