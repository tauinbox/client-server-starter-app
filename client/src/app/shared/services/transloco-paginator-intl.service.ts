import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TranslocoService } from '@jsverse/transloco';

/**
 * `MatPaginator` ships hardcoded English labels, so it is the one Material
 * component whose user-visible text bypasses Transloco. This binds every label
 * to the `common.paginator.*` keys and re-emits `changes` on a language switch,
 * which is what makes an already-rendered paginator re-read them.
 */
@Injectable()
export class TranslocoPaginatorIntl extends MatPaginatorIntl {
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);

  constructor() {
    super();
    this.#applyLabels();
    this.#transloco.langChanges$
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe(() => {
        this.#applyLabels();
        this.changes.next();
      });
  }

  override getRangeLabel = (
    page: number,
    pageSize: number,
    length: number
  ): string => {
    if (length === 0 || pageSize === 0) {
      return this.#transloco.translate('common.paginator.rangeEmpty', {
        total: length
      });
    }
    const start = page * pageSize;
    const end = Math.min(start + pageSize, length);
    return this.#transloco.translate('common.paginator.range', {
      start: start + 1,
      end,
      total: length
    });
  };

  #applyLabels(): void {
    this.itemsPerPageLabel = this.#transloco.translate(
      'common.paginator.itemsPerPage'
    );
    this.firstPageLabel = this.#transloco.translate('common.paginator.first');
    this.lastPageLabel = this.#transloco.translate('common.paginator.last');
    this.nextPageLabel = this.#transloco.translate('common.paginator.next');
    this.previousPageLabel = this.#transloco.translate(
      'common.paginator.previous'
    );
  }
}
