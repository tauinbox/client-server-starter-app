import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { Field } from '@angular/forms/signals';
import { FormField } from '@angular/forms/signals';
import { MatOption } from '@angular/material/core';
import {
  MatError,
  MatFormField,
  MatHint,
  MatLabel,
  MatPrefix
} from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatSelect } from '@angular/material/select';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { CountryCode } from '@app/shared/constants';
import { countryOptions } from '../../utils/residence-country';

/**
 * The select of the declared country of residence, for every form that
 * creates an account. The countries are named in the active language.
 */
@Component({
  selector: 'nxs-residence-country-field',
  imports: [
    FormField,
    MatError,
    MatFormField,
    MatHint,
    MatIcon,
    MatLabel,
    MatOption,
    MatPrefix,
    MatSelect,
    TranslocoDirective
  ],
  templateUrl: './residence-country-field.component.html',
  styleUrl: './residence-country-field.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResidenceCountryFieldComponent {
  readonly #translocoService = inject(TranslocoService);

  readonly field = input.required<Field<CountryCode | ''>>();

  readonly #lang = toSignal(this.#translocoService.langChanges$, {
    initialValue: this.#translocoService.getActiveLang()
  });

  protected readonly countries = computed(() => countryOptions(this.#lang()));
}
