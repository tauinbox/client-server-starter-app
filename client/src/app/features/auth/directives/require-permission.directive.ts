import {
  Directive,
  effect,
  inject,
  input,
  TemplateRef,
  ViewContainerRef
} from '@angular/core';
import { AuthStore } from '../store/auth.store';

@Directive({
  selector: '[appRequirePermission]'
})
export class RequirePermissionDirective {
  readonly appRequirePermission = input.required<string>();

  readonly #templateRef = inject(TemplateRef<unknown>);
  readonly #viewContainer = inject(ViewContainerRef);
  readonly #authStore = inject(AuthStore);

  #hasView = false;

  constructor() {
    effect(() => {
      const permission = this.appRequirePermission();
      const hasPermission = this.#authStore.hasPermission(permission);

      if (hasPermission && !this.#hasView) {
        this.#viewContainer.createEmbeddedView(this.#templateRef);
        this.#hasView = true;
      } else if (!hasPermission && this.#hasView) {
        this.#viewContainer.clear();
        this.#hasView = false;
      }
    });
  }
}
