import { inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { removeEntity, setEntity, withEntities } from '@ngrx/signals/entities';
import type { FeatureFlagResponse } from '@app/shared/types';
import { withCursorList } from '@shared/store/with-cursor-list';
import type {
  CreateFeatureFlag,
  FeatureFlagRuleInput,
  UpdateFeatureFlag
} from '../services/feature-flags-admin.service';
import { FeatureFlagsAdminService } from '../services/feature-flags-admin.service';

type FeatureFlagsAdminState = {
  loading: boolean;
};

export const FeatureFlagsAdminStore = signalStore(
  withEntities<FeatureFlagResponse>(),
  withState<FeatureFlagsAdminState>({ loading: false }),
  withCursorList<FeatureFlagResponse>({
    fallbackKey: 'admin.featureFlags.errorLoadFailed'
  }),
  withMethods((store) => {
    const service = inject(FeatureFlagsAdminService);

    return {
      /** First page; a filter or sort change re-enters through here. */
      load(): void {
        void store.loadFirstPage((request) => service.getAllCursor(request));
      },

      /** Appends the next page; wired to the list's scroll sentinel. */
      loadMore(): void {
        void store.loadNextPage((request) => service.getAllCursor(request));
      },

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

      toggleFlag(id: string): Observable<FeatureFlagResponse> {
        return service.toggle(id).pipe(
          tap((flag) => {
            patchState(store, setEntity(flag));
          })
        );
      },

      replaceRules(
        id: string,
        rules: FeatureFlagRuleInput[]
      ): Observable<FeatureFlagResponse> {
        return service.replaceRules(id, rules).pipe(
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
