import { inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { patchState, signalStore, withMethods } from '@ngrx/signals';
import { removeEntity, setEntity } from '@ngrx/signals/entities';
import type { FeatureFlagResponse } from '@app/shared/types';
import { FEATURE_FLAG_LIST_QUERY } from '@app/shared/constants';
import { withList } from '@shared/store/with-list';
import type {
  CreateFeatureFlag,
  UpdateFeatureFlag
} from '../services/feature-flags-admin.service';
import { FeatureFlagsAdminService } from '../services/feature-flags-admin.service';

export const FeatureFlagsAdminStore = signalStore(
  withList({
    spec: FEATURE_FLAG_LIST_QUERY,
    urlKey: 'flags',
    fallbackKey: 'admin.featureFlags.errorLoadFailed',
    fetcher: () => {
      const service = inject(FeatureFlagsAdminService);
      return (request, filters) => service.getAllCursor(request, filters);
    }
  }),
  withMethods((store) => {
    const service = inject(FeatureFlagsAdminService);

    return {
      createFlag(data: CreateFeatureFlag): Observable<FeatureFlagResponse> {
        return service.create(data).pipe(
          tap((flag) => {
            patchState(store, setEntity(flag));
          })
        );
      },

      updateFlag(
        id: string,
        data: UpdateFeatureFlag,
        expectedVersion: number
      ): Observable<FeatureFlagResponse> {
        return service.update(id, data, expectedVersion).pipe(
          tap((flag) => {
            patchState(store, setEntity(flag));
          })
        );
      },

      reloadFlag(id: string): Observable<FeatureFlagResponse> {
        return service.getOne(id).pipe(
          tap((flag) => {
            patchState(store, setEntity(flag));
          })
        );
      },

      deleteFlag(id: string): Observable<void> {
        return service.delete(id).pipe(
          tap(() => {
            patchState(store, removeEntity(id));
          })
        );
      }
    };
  })
);
