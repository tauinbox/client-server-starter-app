import { inject, Pipe, type PipeTransform } from '@angular/core';
import { FeatureFlagsStore } from '../store/feature-flags.store';

/**
 * Pipe variant of `*nxsHasFeature` for attribute bindings where the
 * structural directive does not fit:
 *
 *   [disabled]="!('beta-export' | featureEnabled)"
 *   [class.beta]="'beta-style' | featureEnabled"
 *
 * Declared impure because the value is sourced from the `FeatureFlagsStore`
 * signal, not from the pipe's input — when the store updates and the key
 * argument is unchanged, a pure pipe would return the memoised value. The
 * transform reduces to a single property lookup so the per-CD-cycle cost is
 * trivial compared with the developer ergonomics of reactive bindings.
 */
@Pipe({
  name: 'featureEnabled',
  standalone: true,
  pure: false
})
export class FeatureEnabledPipe implements PipeTransform {
  readonly #flagsStore = inject(FeatureFlagsStore);

  transform(key: string): boolean {
    return this.#flagsStore.isEnabled(key)();
  }
}
