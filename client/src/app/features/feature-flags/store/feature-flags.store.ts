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

    let inFlight: Promise<void> | null = null;
    // Bumped by clear()/reload() so a response from an older fetch cannot
    // overwrite state that has since been reset or re-fetched.
    let fetchEpoch = 0;

    function fetchFlags(): Promise<void> {
      const epoch = ++fetchEpoch;
      const request = firstValueFrom(service.getEvaluatedFlags())
        .then((response) => {
          if (epoch !== fetchEpoch) return;
          patchState(store, { flags: response.flags, loaded: true });
        })
        .catch(() => {
          // Transient failure: keep `loaded` false so guards and consumers
          // retry on the next navigation instead of latching "everything
          // off" for the rest of the session.
        })
        .finally(() => {
          if (inFlight === request) inFlight = null;
        });
      inFlight = request;
      return request;
    }

    /**
     * Ensures flags are loaded. Joins an in-flight fetch (started by
     * bootstrap, login or a guard) instead of issuing a duplicate request;
     * resolves immediately when flags are already loaded and no fetch is
     * running.
     */
    function load(): Promise<void> {
      if (inFlight) return inFlight;
      if (store.loaded()) return Promise.resolve();
      return fetchFlags();
    }

    /** Always re-fetches, e.g. after login or a flag/role change push. */
    function reload(): Promise<void> {
      return fetchFlags();
    }

    function clear(): void {
      fetchEpoch++;
      inFlight = null;
      patchState(store, { flags: {}, loaded: false });
    }

    function isEnabled(key: string): Signal<boolean> {
      return computed(() => store.flags()[key] === true);
    }

    return { load, reload, clear, isEnabled };
  })
);
