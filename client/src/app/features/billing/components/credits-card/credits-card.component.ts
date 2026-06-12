import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { CreditBalanceResponse } from '@app/shared/types';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { formatUnits } from '../../utils/billing-format';

/**
 * Prepaid-credit wallet card for the billing settings page (design §21.2).
 * A never-bought balance reads as zero; a refund clawback can overdraw it,
 * which pauses usage recording until topped up — the card must say so. The
 * buy/top-up action leads to the credit packs on the pricing page.
 */
@Component({
  selector: 'nxs-credits-card',
  imports: [
    RouterLink,
    MatCard,
    MatCardContent,
    MatButton,
    MatIcon,
    TranslocoDirective
  ],
  templateUrl: './credits-card.component.html',
  styleUrl: './credits-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CreditsCardComponent {
  readonly credits = input.required<CreditBalanceResponse | null>();

  readonly #transloco = inject(TranslocoService);
  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  protected readonly billingRoute = `/${AppRouteSegmentEnum.Billing}`;

  readonly #units = computed(() => this.credits()?.balanceUnits ?? 0);
  protected readonly empty = computed(() => this.#units() === 0);
  protected readonly negative = computed(() => this.#units() < 0);
  protected readonly label = computed(() =>
    formatUnits(this.#units(), this.#lang())
  );
}
