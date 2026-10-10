import { inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Observable } from 'rxjs';
import {
  catchError,
  concatWith,
  EMPTY,
  ignoreElements,
  tap,
  throwError
} from 'rxjs';
import { patchState, signalStore, withMethods } from '@ngrx/signals';
import { removeEntity, setEntity } from '@ngrx/signals/entities';
import type { FeatureFlagResponse } from '@app/shared/types';
import { ErrorKeys, FEATURE_FLAG_LIST_QUERY } from '@app/shared/constants';
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

      // After a version conflict the row is reloaded before the error goes
      // to the caller, so the next edit sends the current version. A failed
      // reload is ignored: the caller already reports the conflict.
      updateFlag(
        id: string,
        data: UpdateFeatureFlag,
        expectedVersion: number
      ): Observable<FeatureFlagResponse> {
        return service.update(id, data, expectedVersion).pipe(
          tap((flag) => {
            patchState(store, setEntity(flag));
          }),
          catchError((err: unknown) => {
            if (
              !(err instanceof HttpErrorResponse) ||
              err.error?.errorKey !== ErrorKeys.FEATURE_FLAGS.VERSION_CONFLICT
            ) {
              return throwError(() => err);
            }
            return service.getOne(id).pipe(
              tap((flag) => {
                patchState(store, setEntity(flag));
              }),
              ignoreElements(),
              catchError(() => EMPTY),
              concatWith(throwError(() => err))
            );
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
