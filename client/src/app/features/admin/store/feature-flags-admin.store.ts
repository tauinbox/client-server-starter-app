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
import { TranslocoService } from '@jsverse/transloco';
import type { FeatureFlagResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import type {
  CreateFeatureFlag,
  FeatureFlagRuleInput,
  UpdateFeatureFlag
} from '../services/feature-flags-admin.service';
import { FeatureFlagsAdminService } from '../services/feature-flags-admin.service';

type FeatureFlagsAdminState = {
  loading: boolean;
  error: string | null;
};

export const FeatureFlagsAdminStore = signalStore(
  withEntities<FeatureFlagResponse>(),
  withState<FeatureFlagsAdminState>({ loading: false, error: null }),
  withMethods((store) => {
    const service = inject(FeatureFlagsAdminService);
    const notify = inject(NotifyService);
    const transloco = inject(TranslocoService);

    return {
      load: rxMethod<void>(
        pipe(
          tap(() => patchState(store, { loading: true, error: null })),
          switchMap(() =>
            service.getAll().pipe(
              tapResponse({
                next: (flags) => {
                  patchState(store, setAllEntities(flags));
                  patchState(store, { loading: false });
                },
                error: () => {
                  patchState(store, {
                    loading: false,
                    error: transloco.translate(
                      'admin.featureFlags.errorLoadFailed'
                    )
                  });
                  notify.error('admin.featureFlags.errorLoadFailed');
                }
              })
            )
          )
        )
      ),

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
