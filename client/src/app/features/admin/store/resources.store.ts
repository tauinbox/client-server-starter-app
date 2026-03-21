import { inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { forkJoin, pipe, switchMap, tap } from 'rxjs';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import type {
  ActionResponse,
  ResourceResponse
} from '@app/shared/types/rbac.types';
import { AuthService } from '@features/auth/services/auth.service';
import type {
  CreateAction,
  UpdateAction,
  UpdateResource
} from '../services/rbac-admin.service';
import { RbacAdminService } from '../services/rbac-admin.service';

type ResourcesState = {
  resources: ResourceResponse[];
  actions: ActionResponse[];
  loading: boolean;
};

export const ResourcesStore = signalStore(
  withState<ResourcesState>({
    resources: [],
    actions: [],
    loading: false
  }),
  withMethods((store) => {
    const rbacService = inject(RbacAdminService);
    const authService = inject(AuthService);
    const snackBar = inject(MatSnackBar);

    return {
      load: rxMethod<void>(
        pipe(
          tap(() => patchState(store, { loading: true })),
          switchMap(() =>
            forkJoin([
              rbacService.getResources(),
              rbacService.getActions()
            ]).pipe(
              tapResponse({
                next: ([resources, actions]) => {
                  patchState(store, { resources, actions, loading: false });
                },
                error: () => {
                  patchState(store, { loading: false });
                  snackBar.open(
                    'Failed to load resources. Please try again.',
                    'Close',
                    { duration: 5000 }
                  );
                }
              })
            )
          )
        )
      ),

      restoreResource(id: string): Observable<ResourceResponse> {
        return rbacService.restoreResource(id).pipe(
          tap((updated) => {
            patchState(store, {
              resources: store
                .resources()
                .map((r) => (r.id === id ? updated : r))
            });
            void authService.fetchRbacMetadata();
          })
        );
      },

      updateResource(
        id: string,
        dto: UpdateResource
      ): Observable<ResourceResponse> {
        return rbacService.updateResource(id, dto).pipe(
          tap((updated) => {
            patchState(store, {
              resources: store
                .resources()
                .map((r) => (r.id === id ? updated : r))
            });
            void authService.fetchRbacMetadata();
          })
        );
      },

      createAction(dto: CreateAction): Observable<ActionResponse> {
        return rbacService.createAction(dto).pipe(
          tap((created) => {
            const sorted = [...store.actions(), created].sort((a, b) =>
              a.name.localeCompare(b.name)
            );
            patchState(store, { actions: sorted });
            void authService.fetchRbacMetadata();
          })
        );
      },

      updateAction(id: string, dto: UpdateAction): Observable<ActionResponse> {
        return rbacService.updateAction(id, dto).pipe(
          tap((updated) => {
            patchState(store, {
              actions: store.actions().map((a) => (a.id === id ? updated : a))
            });
            void authService.fetchRbacMetadata();
          })
        );
      },

      deleteAction(id: string): Observable<void> {
        return rbacService.deleteAction(id).pipe(
          tap(() => {
            patchState(store, {
              actions: store.actions().filter((a) => a.id !== id)
            });
            void authService.fetchRbacMetadata();
          })
        );
      }
    };
  })
);
