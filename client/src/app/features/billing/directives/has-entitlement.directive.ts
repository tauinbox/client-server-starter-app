import {
  Directive,
  effect,
  inject,
  input,
  TemplateRef,
  ViewContainerRef
} from '@angular/core';
import { EntitlementsStore } from '../store/entitlements.store';

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
export class HasEntitlementDirective {
  readonly nxsHasEntitlement = input.required<string>();
  readonly nxsHasEntitlementElse = input<TemplateRef<unknown> | null>(null);

  readonly #templateRef = inject(TemplateRef<unknown>);
  readonly #viewContainer = inject(ViewContainerRef);
  readonly #entitlementsStore = inject(EntitlementsStore);

  #currentBranch: 'then' | 'else' | null = null;

  constructor() {
    void this.#entitlementsStore.load();

    effect(() => {
      const granted = this.#entitlementsStore.has(this.nxsHasEntitlement())();
      const elseTemplate = this.nxsHasEntitlementElse();

      const nextBranch: 'then' | 'else' | null = granted
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
