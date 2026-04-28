import { inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { pipe, switchMap, tap } from 'rxjs';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import {
  removeEntity,
  setAllEntities,
  setEntity,
  withEntities
} from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoService } from '@jsverse/transloco';
import type { RoleAdminResponse } from '@app/shared/types/role.types';
import type { CreateRole, UpdateRole } from '../services/role.service';
import { RoleService } from '../services/role.service';

type RolesState = {
  loading: boolean;
  error: string | null;
};

export const RolesStore = signalStore(
  withEntities<RoleAdminResponse>(),
  withState<RolesState>({
    loading: false,
    error: null
  }),
  withMethods((store) => {
    const roleService = inject(RoleService);
    const snackBar = inject(MatSnackBar);
    const translocoService = inject(TranslocoService);

    return {
      load: rxMethod<void>(
        pipe(
          tap(() => patchState(store, { loading: true, error: null })),
          switchMap(() =>
            roleService.getAll().pipe(
              tapResponse({
                next: (roles) => {
                  patchState(store, setAllEntities(roles));
                  patchState(store, { loading: false });
                },
                error: () => {
                  const errorMsg = translocoService.translate(
                    'admin.store.errorLoadRolesFailed'
                  );
                  patchState(store, {
                    loading: false,
                    error: errorMsg
                  });
                  snackBar.open(
                    errorMsg,
                    translocoService.translate('common.close'),
                    { duration: 5000 }
                  );
                }
              })
            )
          )
        )
      ),

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
