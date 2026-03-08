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
import type { RoleResponse } from '@app/shared/types/role.types';
import type { CreateRole, UpdateRole } from '../services/role.service';
import { RoleService } from '../services/role.service';

type RolesState = {
  loading: boolean;
  error: string | null;
};

export const RolesStore = signalStore(
  withEntities<RoleResponse>(),
  withState<RolesState>({
    loading: false,
    error: null
  }),
  withMethods((store) => {
    const roleService = inject(RoleService);
    const snackBar = inject(MatSnackBar);

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
                  patchState(store, {
                    loading: false,
                    error: 'Failed to load roles. Please try again.'
                  });
                  snackBar.open(
                    'Failed to load roles. Please try again.',
                    'Close',
                    { duration: 5000 }
                  );
                }
              })
            )
          )
        )
      ),

      createRole(data: CreateRole): Observable<RoleResponse> {
        return roleService.create(data).pipe(
          tap((role) => {
            patchState(store, setEntity(role));
          })
        );
      },

      updateRole(id: string, data: UpdateRole): Observable<RoleResponse> {
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
