import { Directive, input } from '@angular/core';

/**
 * Gives `let-row` on an `ng-template` the item type of a list, so a row
 * template shown through `ngTemplateOutlet` is type-checked like the `@for`
 * that feeds it. The input only carries the type; the directive renders
 * nothing.
 *
 * `<ng-template #rowActions [nxsTemplateRowOf]="flags()" let-flag>`
 */
@Directive({
  selector: 'ng-template[nxsTemplateRowOf]'
})
export class TemplateRowOfDirective<T> {
  readonly nxsTemplateRowOf = input.required<readonly T[]>();

  static ngTemplateContextGuard<T>(
    _dir: TemplateRowOfDirective<T>,
    _ctx: unknown
  ): _ctx is { $implicit: T } {
    return true;
  }
}
