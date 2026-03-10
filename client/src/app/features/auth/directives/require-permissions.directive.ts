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

  readonly #templateRef = inject(TemplateRef<unknown>);
  readonly #viewContainer = inject(ViewContainerRef);
  readonly #authStore = inject(AuthStore);

  #hasView = false;

  constructor() {
    effect(() => {
      const hasPermissions = this.#authStore.hasPermissions(
        this.appRequirePermissions()
      );

      if (hasPermissions && !this.#hasView) {
        this.#viewContainer.createEmbeddedView(this.#templateRef);
        this.#hasView = true;
      } else if (!hasPermissions && this.#hasView) {
        this.#viewContainer.clear();
        this.#hasView = false;
      }
    });
  }
}
