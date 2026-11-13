import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output
} from '@angular/core';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import type { PlanResponse } from '@app/shared/types';
import { CatalogTextPipe } from '../../pipes/catalog-text.pipe';

/**
 * Presentational pricing-tier card. The recommended tier is
 * lifted via the `featured` flag (elevation + accent + "Most popular" chip).
 * Emits `choose` when the call-to-action is pressed; the parent owns the
 * action, so the same card serves a checkout, a plan change and the way back
 * to Free.
 */
@Component({
  selector: 'nxs-plan-card',
  imports: [
    MatCard,
    MatCardContent,
    MatButton,
    MatIcon,
    TranslocoDirective,
    CatalogTextPipe
  ],
  templateUrl: './plan-card.component.html',
  styleUrl: './plan-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlanCardComponent {
  readonly plan = input.required<PlanResponse>();
  /** Formatted, currency-aware price for the resolved provider. */
  readonly price = input.required<string>();
  readonly featured = input(false);
  readonly current = input(false);
  /** Translation key of the action label. */
  readonly actionKey = input('billing.pricing.choose');
  /** A status line shown in place of the action, for example a scheduled switch. */
  readonly note = input<string | null>(null);
  readonly disabled = input(false);

  readonly choose = output<string>();

  /**
   * Pay as you go is priced per unit, from the cheapest credit pack; a fixed
   * plan is priced per month.
   */
  protected readonly perUnit = computed(
    () => this.plan().billingMode === 'usage'
  );

  protected readonly priceSuffixKey = computed(() =>
    this.perUnit() ? 'billing.pricing.perUnit' : 'billing.pricing.perMonth'
  );

  onChoose(): void {
    this.choose.emit(this.plan().key);
  }
}
