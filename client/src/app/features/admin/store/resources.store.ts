import { computed, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods
} from '@ngrx/signals';
import { updateEntity } from '@ngrx/signals/entities';
import type { ResourceResponse } from '@app/shared/types';
import { RESOURCE_LIST_QUERY } from '@app/shared/constants';
import { AuthService } from '@features/auth/services/auth.service';
import { withList } from '@shared/store/with-list';
import type { UpdateResource } from '../services/rbac-admin.service';
import { RbacAdminService } from '../services/rbac-admin.service';

/**
 * One list, one store, one entity collection - see the pagination standard in
 * the contributor guide.
 */
export const ResourcesStore = signalStore(
  withList({
    spec: RESOURCE_LIST_QUERY,
    urlKey: 'resources',
    fallbackKey: 'admin.store.errorLoadResourcesFailed',
    fetcher: () => {
      const rbacService = inject(RbacAdminService);
      return (request, filters) =>
        rbacService.getResourcesCursor(request, filters);
    }
  }),
  withComputed((store) => ({
    resources: computed(() => store.entities())
  })),
  withMethods((store) => {
    const rbacService = inject(RbacAdminService);
    const authService = inject(AuthService);

    return {
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
