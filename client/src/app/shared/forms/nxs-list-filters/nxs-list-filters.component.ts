import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { form, maxLength } from '@angular/forms/signals';
import { debounceTime, distinctUntilChanged, filter, map } from 'rxjs';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatCheckbox } from '@angular/material/checkbox';
import { TranslocoDirective } from '@jsverse/transloco';
import { MAX_LIST_FILTER_LENGTH } from '@app/shared/constants';
import { LIST_SEARCH_DEBOUNCE_MS } from '@shared/utils/pagination.utils';
import { NxsFormFieldComponent } from '../nxs-form-field/nxs-form-field.component';

export type ListFilterOption<V> = {
  value: V;
  /** Transloco key, or the text itself when `literal` (data, such as a role name). */
  label: string;
  literal?: boolean;
};

type FilterKey<F> = Exclude<keyof F, 'q'> & string;

/** A select whose first option ("all") clears the filter. */
export type ListFilterSelect<F> = {
  [K in FilterKey<F>]: {
    kind: 'select';
    key: K;
    label: string;
    allLabel: string;
    options: readonly ListFilterOption<NonNullable<F[K]>>[];
  };
}[FilterKey<F>];

/** A checkbox that sets the filter to `true`, and clears it when unchecked. */
export type ListFilterCheckbox<F> = {
  [K in FilterKey<F>]: true extends F[K]
    ? { kind: 'checkbox'; key: K; label: string }
    : never;
}[FilterKey<F>];

export type ListFilterControl<F> = ListFilterSelect<F> | ListFilterCheckbox<F>;

/**
 * The search box and the filter controls of a list page. It holds no filter
 * state of its own: it renders `value` and emits the next value on each
 * change, the search after `LIST_SEARCH_DEBOUNCE_MS` of idle time and a
 * control at once. The page passes the value to its store and reloads.
 */
@Component({
  selector: 'nxs-list-filters',
  imports: [
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
    MatCheckbox,
    TranslocoDirective,
    NxsFormFieldComponent
  ],
  templateUrl: './nxs-list-filters.component.html',
  styleUrl: './nxs-list-filters.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NxsListFiltersComponent<
  F extends { q?: string }
> implements OnInit {
  /** The filters the list shows now. */
  readonly value = input.required<F>();

  readonly controls = input<readonly ListFilterControl<F>[]>([]);

  /** Transloco key of the search field label. */
  readonly searchLabel = input('common.search');

  readonly valueChange = output<F>();

  readonly searchModel = signal({ q: '' });
  readonly searchForm = form(this.searchModel, (path) => {
    maxLength(path.q, MAX_LIST_FILTER_LENGTH);
  });

  readonly selects = computed(() =>
    this.controls().filter(
      (control): control is ListFilterSelect<F> => control.kind === 'select'
    )
  );

  readonly checkboxes = computed(() =>
    this.controls().filter(
      (control): control is ListFilterCheckbox<F> => control.kind === 'checkbox'
    )
  );

  constructor() {
    toObservable(this.searchModel)
      .pipe(
        map((model) => model.q.trim()),
        debounceTime(LIST_SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        // An over-long term is a 400 on the server; the field shows the error.
        filter(() => this.searchForm().valid()),
        takeUntilDestroyed()
      )
      .subscribe((q) => this.#emit('q', q || undefined));
  }

  ngOnInit(): void {
    this.searchModel.set({ q: this.value().q ?? '' });
  }

  /** The select works on option positions, so any option value type fits it. */
  selectedIndex(control: ListFilterSelect<F>): string {
    const current = this.value()[control.key];
    const index = control.options.findIndex(
      (option) => option.value === current
    );
    return index < 0 ? '' : String(index);
  }

  onSelect(control: ListFilterSelect<F>, index: string): void {
    this.#emit(
      control.key,
      index === '' ? undefined : control.options[Number(index)]?.value
    );
  }

  isChecked(control: ListFilterCheckbox<F>): boolean {
    return this.value()[control.key] === true;
  }

  onCheck(control: ListFilterCheckbox<F>, checked: boolean): void {
    this.#emit(control.key, checked ? true : undefined);
  }

  #emit(key: keyof F, next: unknown): void {
    const current = this.value();
    if (current[key] === next) return;
    this.valueChange.emit({ ...current, [key]: next });
  }
}
