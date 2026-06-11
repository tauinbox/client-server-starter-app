import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal
} from '@angular/core';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { form, maxLength, validate } from '@angular/forms/signals';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { BillingProviderId, ProductResponse } from '@app/shared/types';
import { AppFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import {
  formatMoney,
  parseAmountToMinor,
  productPriceFor
} from '../../utils/billing-format';

/** The wireframe's two quick amounts, as multiples of the product's minimum. */
const PRESET_MULTIPLIERS = [3, 5] as const;

export type DonationSubmit = {
  amountMinor: number;
  note?: string;
};

type DonationFormData = {
  amount: string;
  note: string;
};

/**
 * Custom-amount one-time purchase card (design §21.4): quick preset amounts
 * derived from the product's configured minimum, a bounded custom amount, and
 * an optional receipt note. All money facts (currency, bounds) come from the
 * catalog entry priced for the resolved provider — nothing is hardcoded
 * client-side. Emits `donate` with the minor-unit amount; the parent owns the
 * purchase.
 */
@Component({
  selector: 'nxs-donation-card',
  imports: [
    MatCard,
    MatCardContent,
    MatButton,
    MatButtonToggleModule,
    MatIcon,
    AppFormFieldComponent,
    TranslocoDirective
  ],
  templateUrl: './donation-card.component.html',
  styleUrl: './donation-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DonationCardComponent {
  readonly product = input.required<ProductResponse>();
  /** The resolved billing provider whose bounds/currency the form charges in. */
  readonly provider = input.required<BillingProviderId>();
  readonly disabled = input(false);

  readonly donate = output<DonationSubmit>();

  readonly #transloco = inject(TranslocoService);
  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  readonly #price = computed(() =>
    productPriceFor(this.product(), this.provider())
  );

  protected readonly currency = computed(
    () => this.#price()?.currency ?? 'USD'
  );
  protected readonly minMinor = computed(
    () => this.#price()?.minAmountMinor ?? 0
  );
  protected readonly maxMinor = computed(
    () => this.#price()?.maxAmountMinor ?? 0
  );

  /** Quick amounts: small multiples of the configured minimum, within bounds. */
  protected readonly presets = computed(() => {
    const min = this.minMinor();
    const max = this.maxMinor();
    if (min <= 0 || max <= 0) return [];
    return PRESET_MULTIPLIERS.map((factor) => min * factor)
      .filter((amount) => amount <= max)
      .map((amountMinor) => ({
        amountMinor,
        label: formatMoney(amountMinor, this.currency(), this.#lang())
      }));
  });

  /**
   * Selected quick amount in minor units, or 'custom' for the free input.
   * Defaults to the first preset so the pay button is immediately actionable;
   * re-derives if the presets change (provider/language switch).
   */
  protected readonly selection = linkedSignal<number | 'custom'>(
    () => this.presets()[0]?.amountMinor ?? 'custom'
  );

  protected readonly isCustom = computed(() => this.selection() === 'custom');

  readonly donationModel = signal<DonationFormData>({ amount: '', note: '' });

  readonly donationForm = form(this.donationModel, (path) => {
    validate(path.amount, ({ value }) => {
      // A quick preset bypasses the amount field entirely.
      if (!this.isCustom()) return null;
      const minor = parseAmountToMinor(value(), this.currency());
      if (minor === null) {
        return {
          kind: 'amountInvalid',
          message: 'billing.oneTime.amountInvalid'
        };
      }
      if (minor < this.minMinor() || minor > this.maxMinor()) {
        const hint = this.boundsHint();
        return {
          kind: 'amountRange',
          message: 'billing.oneTime.amountRange',
          min: hint.min,
          max: hint.max
        };
      }
      return null;
    });
    maxLength(path.note, 128, { message: 'billing.oneTime.noteTooLong' });
  });

  /** The amount that would be charged right now, in minor units. */
  protected readonly amountMinor = computed(() => {
    const selection = this.selection();
    if (selection !== 'custom') return selection;
    return parseAmountToMinor(this.donationModel().amount, this.currency());
  });

  protected readonly payLabel = computed(() => {
    const minor = this.amountMinor();
    return minor === null
      ? ''
      : formatMoney(minor, this.currency(), this.#lang());
  });

  protected readonly boundsHint = computed(() => {
    const lang = this.#lang();
    const currency = this.currency();
    return {
      min: formatMoney(this.minMinor(), currency, lang),
      max: formatMoney(this.maxMinor(), currency, lang)
    };
  });

  protected canPay(): boolean {
    if (this.disabled()) return false;
    return this.amountMinor() !== null && !this.donationForm().invalid();
  }

  onSelect(selection: number | 'custom'): void {
    this.selection.set(selection);
  }

  onPay(): void {
    if (!this.canPay()) return;
    const amountMinor = this.amountMinor();
    if (amountMinor === null) return;
    const note = this.donationModel().note.trim();
    this.donate.emit({ amountMinor, note: note || undefined });
  }
}
