import { computed, inject, type Signal } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { BillingService } from '../services/billing.service';

type EntitlementsState = {
  planKey: string | null;
  capabilities: string[];
  limits: Record<string, number>;
  loaded: boolean;
};

const EMPTY: EntitlementsState = {
  planKey: null,
  capabilities: [],
  limits: {},
  loaded: false
};

/**
 * Client mirror of the server's resolved entitlements - the third access axis
 * alongside CASL rules and feature flags, and advisory in exactly the same way:
 * `EntitlementGuard` remains the enforcement point, so a stale or tampered
 * mirror grants nothing.
 *
 * Loaded lazily rather than at bootstrap: the read requires auth and a session
 * that never touches a gated surface should not pay for it.
 */
export const EntitlementsStore = signalStore(
  { providedIn: 'root' },
  withState<EntitlementsState>(EMPTY),
  withMethods((store) => {
    const service = inject(BillingService);

    let inFlight: Promise<void> | null = null;
    // Bumped by clear()/reload() so a response from an older fetch cannot
    // overwrite state that has since been reset or re-fetched.
    let fetchEpoch = 0;

    function fetchEntitlements(): Promise<void> {
      const epoch = ++fetchEpoch;
      const request = firstValueFrom(service.getEntitlements())
        .then((response) => {
          if (epoch !== fetchEpoch) return;
          patchState(store, {
            planKey: response.planKey,
            capabilities: response.capabilities,
            limits: response.limits,
            loaded: true
          });
        })
        .catch(() => {
          // Transient failure: keep `loaded` false so consumers retry on the
          // next navigation instead of latching "nothing granted" for the rest
          // of the session.
        })
        .finally(() => {
          if (inFlight === request) inFlight = null;
        });
      inFlight = request;
      return request;
    }

    /** Joins an in-flight fetch instead of issuing a duplicate request. */
    function load(): Promise<void> {
      if (inFlight) return inFlight;
      if (store.loaded()) return Promise.resolve();
      return fetchEntitlements();
    }

    /** Always re-fetches, e.g. on an `entitlements_updated` push. */
    function reload(): Promise<void> {
      return fetchEntitlements();
    }

    function clear(): void {
      fetchEpoch++;
      inFlight = null;
      patchState(store, EMPTY);
    }

    function has(capability: string): Signal<boolean> {
      return computed(() => store.capabilities().includes(capability));
    }

    /** `null` when the plan in force carries no limit under that key. */
    function limit(key: string): Signal<number | null> {
      return computed(() => store.limits()[key] ?? null);
    }

    return { load, reload, clear, has, limit };
  })
);
