import { inject, Pipe, type PipeTransform } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import {
  catalogText,
  type CatalogField,
  type CatalogItem,
  type CatalogKind
} from '../utils/catalog-text';

/**
 * Template form of `catalogText`:
 *
 *   {{ plan() | catalogText: 'plans' : 'name' }}
 *
 * Impure because the result follows the active language, not the input. The
 * transform is one map lookup, so the cost per change detection is small.
 */
@Pipe({
  name: 'catalogText',
  pure: false
})
export class CatalogTextPipe implements PipeTransform {
  readonly #transloco = inject(TranslocoService);

  transform(
    item: CatalogItem | null | undefined,
    kind: CatalogKind,
    field: CatalogField
  ): string {
    return item ? catalogText(this.#transloco, kind, item, field) : '';
  }
}
