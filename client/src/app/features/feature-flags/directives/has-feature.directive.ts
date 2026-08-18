import { Directive, effect, inject, input } from '@angular/core';
import type { TemplateRef } from '@angular/core';
import { FeatureFlagsStore } from '../store/feature-flags.store';
import { TemplateBranch } from '@shared/directives/template-branch';

/**
 * Structural directive that renders the host template only while the named
 * flag is on; renders an optional `nxsHasFeatureElse` template (typically a
 * "coming soon" placeholder) when it is off. Reactive to store updates via
 * `effect()` - toggling a flag via SSE propagates without manual reload.
 *
 * Mirrors the API surface of `RequirePermissionsDirective`.
 */
@Directive({
  selector: '[nxsHasFeature]'
})
export class HasFeatureDirective extends TemplateBranch {
  readonly nxsHasFeature = input.required<string>();
  readonly nxsHasFeatureElse = input<TemplateRef<unknown> | null>(null);

  readonly #flagsStore = inject(FeatureFlagsStore);

  constructor() {
    super();

    effect(() => {
      this.render(
        this.#flagsStore.isEnabled(this.nxsHasFeature())(),
        this.nxsHasFeatureElse()
      );
    });
  }
}
