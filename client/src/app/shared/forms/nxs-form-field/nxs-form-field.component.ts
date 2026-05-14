import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import type { Field } from '@angular/forms/signals';
import { FormField } from '@angular/forms/signals';
import {
  MatError,
  MatFormField,
  MatLabel,
  MatPrefix,
  MatSuffix
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import { DEFAULT_ERROR_KEYS } from '@shared/forms';

let nextId = 0;

/**
 * Unified form-field wrapper around `mat-form-field`.
 *
 * Accepts a Signal Forms `Field<string>` and resolves validation
 * error messages via:
 * 1. schema-provided `message` (i18n key set in the form schema)
 * 2. per-field `[errors]` override map
 * 3. `DEFAULT_ERROR_KEYS` registry
 * 4. fallback `forms.errors.unknown`
 *
 * Handles `aria-describedby` linkage, decorative prefix icon (`aria-hidden`),
 * and suffix content projection for password toggles etc.
 */
@Component({
  selector: 'nxs-form-field',
  imports: [
    FormField,
    MatFormField,
    MatLabel,
    MatError,
    MatPrefix,
    MatSuffix,
    MatInput,
    MatIcon,
    TranslocoDirective
  ],
  templateUrl: './nxs-form-field.component.html',
  styleUrl: './nxs-form-field.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppFormFieldComponent {
  /** Signal Forms field bound to the input. */
  readonly field = input.required<Field<string>>();

  /** Transloco i18n key for the label. */
  readonly label = input.required<string>();

  /** Input type. */
  readonly type = input<'text' | 'email' | 'password' | 'textarea'>('text');

  /** Per-field validator-code to i18n-key override map (fallback for schemas without `message`). */
  readonly errors = input<Record<string, string>>({});

  /** Material icon name for the decorative prefix. */
  readonly prefixIcon = input<string>();

  /** HTML `autocomplete` attribute value. */
  readonly autocomplete = input<string>();

  /** Number of rows for textarea type. */
  readonly rows = input<number>(3);

  /** Stable unique id for aria-describedby linkage. */
  readonly errorId = `nxs-ff-err-${++nextId}`;

  /**
   * Resolves the first active validation error into an i18n key + params.
   * Returns `null` when the field is untouched or valid.
   */
  readonly activeError = computed(() => {
    const state = this.field()();
    if (!state.touched() || !state.invalid()) return null;

    const errs = state.errors();
    if (errs.length === 0) return null;

    const err = errs[0];
    const overrides = this.errors();
    const key =
      err.message ||
      overrides[err.kind] ||
      DEFAULT_ERROR_KEYS[err.kind] ||
      'forms.errors.unknown';

    const {
      kind: _,
      fieldTree: _ft,
      formField: _ff,
      message: _m,
      ...params
    } = err;
    return { key, params };
  });
}
