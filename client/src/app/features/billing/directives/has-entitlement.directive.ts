import { Directive, effect, inject, input } from '@angular/core';
import type { TemplateRef } from '@angular/core';
import { EntitlementsStore } from '../store/entitlements.store';
import { TemplateBranch } from '@shared/directives/template-branch';

/**
 * Structural directive that renders the host template only while the caller's
 * resolved entitlements carry the named capability; renders an optional
 * `nxsHasEntitlementElse` template (typically an upgrade prompt) otherwise.
 *
 * Mirrors the API surface of `HasFeatureDirective`, but on the entitlement axis:
 * flags are admin-toggled rollout tools, entitlements are what a paid plan
 * grants. Advisory only - the server's `EntitlementGuard` is the boundary.
 *
 * Fails closed while the mirror is unloaded, and triggers the lazy load itself
 * so a gated surface does not have to be paired with a resolver.
 */
@Directive({
  selector: '[nxsHasEntitlement]'
})
export class HasEntitlementDirective extends TemplateBranch {
  readonly nxsHasEntitlement = input.required<string>();
  readonly nxsHasEntitlementElse = input<TemplateRef<unknown> | null>(null);

  readonly #entitlementsStore = inject(EntitlementsStore);

  constructor() {
    super();

    void this.#entitlementsStore.load();

    effect(() => {
      this.render(
        this.#entitlementsStore.has(this.nxsHasEntitlement())(),
        this.nxsHasEntitlementElse()
      );
    });
  }
}
