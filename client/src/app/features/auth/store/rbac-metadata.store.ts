import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import type { ResourceResponse, ActionResponse } from '@app/shared/types';
import { LocalStorageService } from '@core/services/local-storage.service';

const RBAC_CACHE_KEY = 'rbac_metadata';

type RbacMetadataState = {
  resources: ResourceResponse[];
  actions: ActionResponse[];
  loaded: boolean;
};

export const RbacMetadataStore = signalStore(
  { providedIn: 'root' },
  withState<RbacMetadataState>(() => {
    const storage = inject(LocalStorageService);
    const cached = storage.getItem<{
      resources: ResourceResponse[];
      actions: ActionResponse[];
    }>(RBAC_CACHE_KEY);
    return {
      resources: cached?.resources ?? [],
      actions: cached?.actions ?? [],
      loaded: false
    };
  }),
  withComputed((store) => ({
    subjectMap: computed(() => {
      const map: Record<string, string> = {};
      for (const r of store.resources()) {
        map[r.name] = r.subject;
      }
      return map;
    })
  })),
  withMethods((store) => {
    const storage = inject(LocalStorageService);

    return {
      setMetadata(
        resources: ResourceResponse[],
        actions: ActionResponse[]
      ): void {
        storage.setItem(RBAC_CACHE_KEY, { resources, actions });
        patchState(store, { resources, actions, loaded: true });
      },
      clear(): void {
        storage.removeItem(RBAC_CACHE_KEY);
        patchState(store, { resources: [], actions: [], loaded: false });
      }
    };
  })
);
