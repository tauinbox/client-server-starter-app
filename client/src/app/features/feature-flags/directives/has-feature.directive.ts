import {
  Directive,
  effect,
  inject,
  input,
  TemplateRef,
  ViewContainerRef
} from '@angular/core';
import { FeatureFlagsStore } from '../store/feature-flags.store';

/**
 * Structural directive that renders the host template only while the named
 * flag is on; renders an optional `nxsHasFeatureElse` template (typically a
 * "coming soon" placeholder) when it is off. Reactive to store updates via
 * `effect()` — toggling a flag via SSE propagates without manual reload.
 *
 * Mirrors the API surface of `RequirePermissionsDirective`.
 */
@Directive({
  selector: '[nxsHasFeature]'
})
export class HasFeatureDirective {
  readonly nxsHasFeature = input.required<string>();
  readonly nxsHasFeatureElse = input<TemplateRef<unknown> | null>(null);

  readonly #templateRef = inject(TemplateRef<unknown>);
  readonly #viewContainer = inject(ViewContainerRef);
  readonly #flagsStore = inject(FeatureFlagsStore);

  #currentBranch: 'then' | 'else' | null = null;

  constructor() {
    effect(() => {
      const enabled = this.#flagsStore.isEnabled(this.nxsHasFeature())();
      const elseTemplate = this.nxsHasFeatureElse();

      const nextBranch: 'then' | 'else' | null = enabled
        ? 'then'
        : elseTemplate
          ? 'else'
          : null;

      if (nextBranch === this.#currentBranch) {
        return;
      }

      this.#viewContainer.clear();

      if (nextBranch === 'then') {
        this.#viewContainer.createEmbeddedView(this.#templateRef);
      } else if (nextBranch === 'else' && elseTemplate) {
        this.#viewContainer.createEmbeddedView(elseTemplate);
      }

      this.#currentBranch = nextBranch;
    });
  }
}
