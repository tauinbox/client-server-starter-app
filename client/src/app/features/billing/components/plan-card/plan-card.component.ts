import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { TranslocoDirective } from '@jsverse/transloco';
import type { PlanResponse } from '@app/shared/types';

/**
 * Presentational pricing-tier card (design §21.1). The recommended tier is
 * lifted via the `featured` flag (elevation + accent + "Most popular" chip).
 * Emits `choose` when the call-to-action is pressed; the parent owns checkout.
 */
@Component({
  selector: 'nxs-plan-card',
  imports: [
    MatCard,
    MatCardContent,
    MatButton,
    MatIcon,
    MatChipsModule,
    TranslocoDirective
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
  readonly disabled = input(false);

  readonly choose = output<string>();

  onChoose(): void {
    this.choose.emit(this.plan().key);
  }
}
