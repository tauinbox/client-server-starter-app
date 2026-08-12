import { computed, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods
} from '@ngrx/signals';
import {
  addEntity,
  removeEntity,
  updateEntity,
  withEntities
} from '@ngrx/signals/entities';
import type { ActionResponse } from '@app/shared/types/rbac.types';
import { AuthService } from '@features/auth/services/auth.service';
import { withCursorList } from '@shared/store/with-cursor-list';
import type {
  CreateAction,
  UpdateAction
} from '../services/rbac-admin.service';
import { RbacAdminService } from '../services/rbac-admin.service';

/** Actions list of the resources page; see `ResourcesStore` for the pattern. */
export const ActionsStore = signalStore(
  withEntities<ActionResponse>(),
  withCursorList<ActionResponse>({
    errorKey: 'admin.store.errorLoadActionsFailed'
  }),
  withComputed((store) => ({
    actions: computed(() => store.entities())
  })),
  withMethods((store) => {
    const rbacService = inject(RbacAdminService);
    const authService = inject(AuthService);

    return {
      load(): void {
        void store.loadFirstPage((request) =>
          rbacService.getActionsCursor(request)
        );
      },

      loadMore(): void {
        void store.loadNextPage((request) =>
          rbacService.getActionsCursor(request)
        );
      },

      createAction(dto: CreateAction): Observable<ActionResponse> {
        return rbacService.createAction(dto).pipe(
          tap((created) => {
            // Prepended into the loaded page rather than sorted into the whole
            // catalog: with a cursor there is no whole catalog on the client,
            // and the row must stay visible after the dialog closes.
            patchState(store, addEntity(created));
            void authService.fetchRbacMetadata();
          })
        );
      },

      updateAction(id: string, dto: UpdateAction): Observable<ActionResponse> {
        return rbacService.updateAction(id, dto).pipe(
          tap((updated) => {
            patchState(store, updateEntity({ id, changes: updated }));
            void authService.fetchRbacMetadata();
          })
        );
      },

      deleteAction(id: string): Observable<void> {
        return rbacService.deleteAction(id).pipe(
          tap(() => {
            patchState(store, removeEntity(id));
            void authService.fetchRbacMetadata();
          })
        );
      }
    };
  })
);
