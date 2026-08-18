import { Directive, effect, inject, input } from '@angular/core';
import type { TemplateRef } from '@angular/core';
import { AuthStore } from '../store/auth.store';
import { TemplateBranch } from '@shared/directives/template-branch';
import type { PermissionCheck } from '../casl/app-ability';

@Directive({
  selector: '[nxsRequirePermissions]'
})
export class RequirePermissionsDirective extends TemplateBranch {
  readonly nxsRequirePermissions = input.required<
    PermissionCheck | PermissionCheck[]
  >();

  readonly nxsRequirePermissionsElse = input<TemplateRef<unknown> | null>(null);

  readonly #authStore = inject(AuthStore);

  constructor() {
    super();

    effect(() => {
      this.render(
        this.#authStore.hasPermissions(this.nxsRequirePermissions()),
        this.nxsRequirePermissionsElse()
      );
    });
  }
}
