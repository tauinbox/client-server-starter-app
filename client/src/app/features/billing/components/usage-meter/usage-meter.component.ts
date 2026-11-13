import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { MatCard, MatCardContent } from '@angular/material/card';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { UsageSummaryResponse } from '@app/shared/types';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
import { formatUnits } from '../../utils/billing-format';

/**
 * Pay-as-you-go usage meter: the credit units that metered uses took in the
 * current calendar month (design §22.5). Each use is paid when it happens, so
 * there is no amount due.
 */
@Component({
  selector: 'nxs-usage-meter',
  imports: [LocalizedDatePipe, MatCard, MatCardContent, TranslocoDirective],
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

  protected readonly spentLabel = computed(() =>
    formatUnits(this.usage().unitsSpent, this.#lang())
  );
}
