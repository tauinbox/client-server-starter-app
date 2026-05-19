import { computed, inject, type Signal } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { FeatureFlagService } from '../services/feature-flag.service';

type FeatureFlagsState = {
  flags: Record<string, boolean>;
  loaded: boolean;
};

export const FeatureFlagsStore = signalStore(
  { providedIn: 'root' },
  withState<FeatureFlagsState>({ flags: {}, loaded: false }),
  withComputed((store) => ({
    flagKeys: computed(() => Object.keys(store.flags()))
  })),
  withMethods((store) => {
    const service = inject(FeatureFlagService);

    async function load(): Promise<void> {
      try {
        const response = await firstValueFrom(service.getEvaluatedFlags());
        patchState(store, { flags: response.flags, loaded: true });
      } catch {
        // Best-effort — UI continues to render with `flags: {}` (everything off).
        patchState(store, { loaded: true });
      }
    }

    async function reload(): Promise<void> {
      await load();
    }

    function clear(): void {
      patchState(store, { flags: {}, loaded: false });
    }

    function isEnabled(key: string): Signal<boolean> {
      return computed(() => store.flags()[key] === true);
    }

    return { load, reload, clear, isEnabled };
  })
);
