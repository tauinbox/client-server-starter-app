import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCard, MatCardContent } from '@angular/material/card';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { UsageSummaryResponse } from '@app/shared/types';
import { formatMoney } from '../../utils/billing-format';

/**
 * Current-period usage meter (design §12). Plans with included units get a
 * quota gauge — used quota in the primary tone, overage in the error tone;
 * pure pay-as-you-go plans (no included units) skip the gauge since there is
 * no cap to measure against. The money mini-ledger ends in the accrued amount.
 */
@Component({
  selector: 'nxs-usage-meter',
  imports: [DatePipe, MatCard, MatCardContent, TranslocoDirective],
  templateUrl: './usage-meter.component.html',
  styleUrl: './usage-meter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UsageMeterComponent {
  readonly usage = input.required<UsageSummaryResponse>();

  readonly #transloco = inject(TranslocoService);
  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  protected readonly hasQuota = computed(() => this.usage().includedUnits > 0);
  protected readonly hasOverage = computed(
    () => this.usage().billableUnits > 0
  );

  // Gauge scale: the quota while under it, the actual total once over — the
  // bar reads "how full" below quota and "how much is overage" above it.
  readonly #scale = computed(() =>
    Math.max(this.usage().totalUnits, this.usage().includedUnits)
  );

  protected readonly includedPct = computed(() => {
    const { totalUnits, includedUnits } = this.usage();
    return (Math.min(totalUnits, includedUnits) / this.#scale()) * 100;
  });

  protected readonly overagePct = computed(
    () => (this.usage().billableUnits / this.#scale()) * 100
  );

  protected readonly totalLabel = computed(() =>
    this.#formatUnits(this.usage().totalUnits)
  );

  protected readonly includedLabel = computed(() =>
    this.#formatUnits(this.usage().includedUnits)
  );

  protected readonly billableLabel = computed(() =>
    this.#formatUnits(this.usage().billableUnits)
  );

  protected readonly unitPriceLabel = computed(() =>
    formatMoney(
      this.usage().unitPriceMinor,
      this.usage().currency,
      this.#lang()
    )
  );

  protected readonly accruedLabel = computed(() =>
    formatMoney(this.usage().amountMinor, this.usage().currency, this.#lang())
  );

  #formatUnits(units: number): string {
    return new Intl.NumberFormat(this.#lang()).format(units);
  }
}
