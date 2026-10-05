import { inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { patchState, signalStore, withMethods } from '@ngrx/signals';
import { removeEntity, setEntity } from '@ngrx/signals/entities';
import type { RoleAdminResponse } from '@app/shared/types';
import { ROLE_LIST_QUERY } from '@app/shared/constants';
import { withList } from '@shared/store/with-list';
import type { CreateRole, UpdateRole } from '../services/role.service';
import { RoleService } from '../services/role.service';

export const RolesStore = signalStore(
  withList({
    spec: ROLE_LIST_QUERY,
    urlKey: 'roles',
    fallbackKey: 'admin.store.errorLoadRolesFailed',
    fetcher: () => {
      const roleService = inject(RoleService);
      return (request, filters) => roleService.getAllCursor(request, filters);
    }
  }),
  withMethods((store) => {
    const roleService = inject(RoleService);

    return {
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
