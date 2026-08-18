import { inject, TemplateRef, ViewContainerRef } from '@angular/core';

/**
 * Base for structural directives that swap between the host template and an
 * optional `else` template based on a boolean gate. Subclasses own the inputs
 * and the `effect()` that reads them, and call `render()` with the resolved
 * condition; this class owns the view-container bookkeeping so a branch is
 * re-created only when it actually changes.
 *
 * No `@Directive()` decorator is needed: the refs are resolved through
 * `inject()` in field initialisers, so subclasses inherit them without
 * declaring a constructor signature.
 */
export abstract class TemplateBranch {
  readonly #templateRef = inject(TemplateRef<unknown>);
  readonly #viewContainer = inject(ViewContainerRef);

  #currentBranch: 'then' | 'else' | null = null;

  protected render(
    condition: boolean,
    elseTemplate: TemplateRef<unknown> | null
  ): void {
    const nextBranch: 'then' | 'else' | null = condition
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
  }
}
