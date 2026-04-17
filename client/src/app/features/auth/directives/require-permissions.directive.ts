import {
  Directive,
  effect,
  inject,
  input,
  TemplateRef,
  ViewContainerRef
} from '@angular/core';
import { AuthStore } from '../store/auth.store';
import type { PermissionCheck } from '../casl/app-ability';

@Directive({
  selector: '[appRequirePermissions]'
})
export class RequirePermissionsDirective {
  readonly appRequirePermissions = input.required<
    PermissionCheck | PermissionCheck[]
  >();

  readonly appRequirePermissionsElse = input<TemplateRef<unknown> | null>(null);

  readonly #templateRef = inject(TemplateRef<unknown>);
  readonly #viewContainer = inject(ViewContainerRef);
  readonly #authStore = inject(AuthStore);

  #currentBranch: 'then' | 'else' | null = null;

  constructor() {
    effect(() => {
      const hasPermissions = this.#authStore.hasPermissions(
        this.appRequirePermissions()
      );
      const elseTemplate = this.appRequirePermissionsElse();

      const nextBranch: 'then' | 'else' | null = hasPermissions
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
