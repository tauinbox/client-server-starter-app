import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import {
  MatAutocompleteModule,
  type MatAutocompleteSelectedEvent
} from '@angular/material/autocomplete';
import {
  MatChipsModule,
  type MatChipInputEvent
} from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { TranslocoDirective } from '@jsverse/transloco';

export type ChipOption = {
  /** Stable identifier persisted to the API (e.g. user UUID, role name, env name). */
  value: string;
  /** Human-readable text shown inside the chip and in the autocomplete list. */
  label: string;
  /** Optional secondary text shown muted in the autocomplete list (e.g. email, description). */
  sub?: string;
};

/**
 * Reusable chip + autocomplete wrapper. Three operating modes via inputs:
 *
 *   - `allowFreeText=true`  → pressing Enter or comma turns the typed text into
 *     a chip with `value === label` (e.g. environments, attribute `op=in`).
 *   - `allowFreeText=false` + `options` populated → only chips coming from the
 *     autocomplete suggestions can be added (e.g. role names from a local list).
 *   - Same as above + parent re-emits `options` in response to `searchTermChange`
 *     → async search (e.g. user search by name/email).
 *
 * Container responsibilities: provide labels for already-selected values when
 * editing, drive `options` on search-term changes when async, debounce as needed.
 */
@Component({
  selector: 'nxs-chips-autocomplete',
  imports: [
    MatFormFieldModule,
    MatAutocompleteModule,
    MatChipsModule,
    MatInput,
    MatIcon,
    TranslocoDirective
  ],
  templateUrl: './nxs-chips-autocomplete.component.html',
  styleUrl: './nxs-chips-autocomplete.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChipsAutocompleteComponent {
  readonly selected = input.required<ChipOption[]>();
  readonly options = input<ChipOption[]>([]);
  readonly allowFreeText = input(false);
  readonly label = input<string>('');
  readonly placeholder = input<string>('');
  readonly ariaLabel = input<string>('');

  readonly selectedChange = output<ChipOption[]>();
  readonly searchTermChange = output<string>();

  protected readonly separators = [ENTER, COMMA];
  protected readonly inputValue = signal('');

  protected readonly inputEl =
    viewChild.required<ElementRef<HTMLInputElement>>('chipInput');

  protected readonly filteredOptions = computed<ChipOption[]>(() => {
    const term = this.inputValue().trim().toLowerCase();
    const taken = new Set(this.selected().map((c) => c.value));
    return this.options().filter((opt) => {
      if (taken.has(opt.value)) return false;
      if (term.length === 0) return true;
      if (opt.label.toLowerCase().includes(term)) return true;
      return opt.sub ? opt.sub.toLowerCase().includes(term) : false;
    });
  });

  protected onInput(value: string): void {
    this.inputValue.set(value);
    this.searchTermChange.emit(value);
  }

  protected addFromTokenEnd(event: MatChipInputEvent): void {
    const raw = event.value.trim();
    event.chipInput?.clear();
    this.inputValue.set('');
    if (!this.allowFreeText() || raw.length === 0) return;
    if (this.selected().some((c) => c.value === raw)) return;
    this.selectedChange.emit([...this.selected(), { value: raw, label: raw }]);
  }

  protected addFromOption(event: MatAutocompleteSelectedEvent): void {
    const option = event.option.value as ChipOption;
    this.#clearInput();
    if (this.selected().some((c) => c.value === option.value)) return;
    this.selectedChange.emit([...this.selected(), option]);
  }

  protected removeChip(option: ChipOption): void {
    const next = this.selected().filter((c) => c.value !== option.value);
    this.selectedChange.emit(next);
  }

  #clearInput(): void {
    this.inputEl().nativeElement.value = '';
    this.inputValue.set('');
    this.searchTermChange.emit('');
  }
}
