import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { FormControl, ValidationErrors } from '@angular/forms';
import { ReactiveFormsModule } from '@angular/forms';
import {
  MatError,
  MatFormField,
  MatHint,
  MatLabel,
  MatPrefix
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import { DEFAULT_ERROR_KEYS } from '@shared/forms';

let nextId = 0;

/**
 * Unified form-field wrapper around `mat-form-field`.
 *
 * Resolves validation error messages via:
 * 1. per-field `[errors]` override map
 * 2. `DEFAULT_ERROR_KEYS` registry
 * 3. fallback `forms.errors.unknown`
 *
 * Handles `aria-describedby` linkage, decorative prefix icon (`aria-hidden`),
 * and suffix content projection for password toggles etc.
 */
@Component({
  selector: 'app-form-field',
  imports: [
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatError,
    MatHint,
    MatPrefix,
    MatInput,
    MatIcon,
    TranslocoDirective
  ],
  templateUrl: './app-form-field.component.html',
  styleUrl: './app-form-field.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppFormFieldComponent {
  /** Reactive form control bound to the input. */
  readonly control = input.required<FormControl<string>>();

  /** Transloco i18n key for the label. */
  readonly label = input.required<string>();

  /** Input type. */
  readonly type = input<'text' | 'email' | 'password' | 'textarea'>('text');

  /** Per-field validator-code to i18n-key override map. */
  readonly errors = input<Record<string, string>>({});

  /** Material icon name for the decorative prefix. */
  readonly prefixIcon = input<string>();

  /** Transloco i18n key for the hint text. */
  readonly hint = input<string>();

  /** HTML `autocomplete` attribute value. */
  readonly autocomplete = input<string>();

  /** Number of rows for textarea type. */
  readonly rows = input<number>(3);

  /** Stable unique id for aria-describedby linkage. */
  readonly errorId = `app-ff-err-${++nextId}`;

  /**
   * Resolves the i18n key for the first active validation error.
   * Called from the template so Angular's change detection picks up
   * FormControl status changes naturally.
   */
  getActiveErrorKey(): string | null {
    const ctrl = this.control();
    if (!ctrl.errors) return null;

    const overrides = this.errors();
    const codes = Object.keys(ctrl.errors);

    for (const code of codes) {
      if (overrides[code]) return overrides[code];
      if (DEFAULT_ERROR_KEYS[code]) return DEFAULT_ERROR_KEYS[code];
    }

    return 'forms.errors.unknown';
  }

  /**
   * Extracts interpolation params from the first active error
   * (e.g. `{ requiredLength: 8 }` from minlength).
   */
  getErrorParams(): Record<string, unknown> {
    const ctrl = this.control();
    if (!ctrl.errors) return {};

    const codes = Object.keys(ctrl.errors);
    if (codes.length === 0) return {};

    const errorValue = ctrl.errors[codes[0]] as ValidationErrors | true;
    if (typeof errorValue === 'object' && errorValue !== null) {
      return errorValue as Record<string, unknown>;
    }
    return {};
  }
}
