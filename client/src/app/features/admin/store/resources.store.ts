import { computed, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods
} from '@ngrx/signals';
import { updateEntity, withEntities } from '@ngrx/signals/entities';
import type { ResourceResponse } from '@app/shared/types';
import { AuthService } from '@features/auth/services/auth.service';
import { withCursorList } from '@shared/store/with-cursor-list';
import type { UpdateResource } from '../services/rbac-admin.service';
import { RbacAdminService } from '../services/rbac-admin.service';

/**
 * One list, one store, one entity collection. The resources page shows two
 * lists, so it provides this store next to `ActionsStore` rather than holding
 * both collections here - see the pagination standard in the contributor guide.
 */
export const ResourcesStore = signalStore(
  withEntities<ResourceResponse>(),
  withCursorList<ResourceResponse>({
    fallbackKey: 'admin.store.errorLoadResourcesFailed'
  }),
  withComputed((store) => ({
    resources: computed(() => store.entities())
  })),
  withMethods((store) => {
    const rbacService = inject(RbacAdminService);
    const authService = inject(AuthService);

    return {
      load(): void {
        void store.loadFirstPage((request) =>
          rbacService.getResourcesCursor(request)
        );
      },

      loadMore(): void {
        void store.loadNextPage((request) =>
          rbacService.getResourcesCursor(request)
        );
      },

      restoreResource(id: string): Observable<ResourceResponse> {
        return rbacService.restoreResource(id).pipe(
          tap((updated) => {
            patchState(store, updateEntity({ id, changes: updated }));
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
            patchState(store, updateEntity({ id, changes: updated }));
            void authService.fetchRbacMetadata();
          })
        );
      }
    };
  })
);
